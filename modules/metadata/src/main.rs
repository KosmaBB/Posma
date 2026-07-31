//! metadata sidecar: inspects user-picked JPEG/PNG files for embedded
//! metadata and strips it in place, field by field.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"inspect","paths":["/abs/path", ...]}
//!   {"cmd":"clean","items":[{"path":"/abs/path","keep_fields":["datetime"]}, ...]}
//!
//! Inspect returns a human-readable field list per file (e.g. "Data
//! wykonania: 2024:03:11 10:02:03", "Lokalizacja GPS: 52.22960° N, ..."),
//! not just presence flags — so the UI can show what's actually inside a
//! file before it's gone. Clean strips every field except the ones named in
//! `keep_fields`, e.g. keeping the shot date while stripping GPS/camera/etc.
//!
//! Field ids: "datetime", "camera", "software", "gps", "other_exif"
//! (everything else packed in IFD0/ExifSubIFD, bundled since decoding every
//! possible TIFF tag isn't worthwhile), "comment" (JPEG COM), "xmp",
//! "photoshop" (JPEG APP13/IPTC, opaque), "unknown" (unrecognized
//! APPn/text chunk, opaque), "text:<keyword>" (PNG tEXt/zTXt/iTXt, one per
//! keyword — these are already separate chunks so keeping/stripping them
//! individually is free, no rewriting needed).
//!
//! Scope: JPEG and PNG only — the two formats that turn up GPS/author
//! metadata in practice from phones and cameras. PDF/office document
//! metadata is a different container format entirely and is left for later.
//!
//! Selective field keeping requires rewriting the TIFF/Exif byte structure
//! (IFD0, optionally its ExifSubIFD and GPS sub-IFD) rather than just
//! deleting a whole segment — see `rebuild_tiff`. That rewriter bails
//! (returns None) rather than guess on anything that doesn't parse as
//! expected; the caller then leaves that unit untouched rather than risk
//! corrupting the file. Worst case: a field the user asked to strip
//! survives in a malformed file. It never corrupts the image itself, and
//! pixel/scan data is always copied through byte-for-byte, never touched.
//!
//! Safety: like the shredder module, paths are picked one-by-one through the
//! OS-native file dialog, a deliberate per-item choice, so there is no
//! home-directory restriction here.

use std::collections::HashSet;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

const PNG_SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Deserialize)]
struct CleanItem {
    path: String,
    #[serde(default)]
    keep_fields: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Inspect { paths: Vec<String> },
    Clean { items: Vec<CleanItem> },
}

#[derive(Serialize, Clone)]
struct MetaField {
    id: String,
    label: String,
    value: String,
}

#[derive(Serialize, Default)]
struct FileInfo {
    path: String,
    format: String,
    supported: bool,
    fields: Vec<MetaField>,
    metadata_bytes: u64,
    size: u64,
    error: Option<String>,
}

#[derive(Serialize)]
struct CleanEntry {
    path: String,
    cleaned: bool,
    freed_bytes: u64,
    removed_fields: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct CleanResult {
    entries: Vec<CleanEntry>,
    total_freed: u64,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

fn ok<T: Serialize>(data: T) -> Response<T> {
    Response::Ok { ok: true, data }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n).collect();
    out.push('…');
    out
}

// ---------------------------------------------------------------- TIFF/Exif

#[derive(Clone)]
struct TiffEntry {
    tag: u16,
    ty: u16,
    count: u32,
    data: Vec<u8>,
}

fn read_u16(b: &[u8], off: usize, le: bool) -> Option<u16> {
    let s = b.get(off..off + 2)?;
    Some(if le { u16::from_le_bytes([s[0], s[1]]) } else { u16::from_be_bytes([s[0], s[1]]) })
}
fn read_u32(b: &[u8], off: usize, le: bool) -> Option<u32> {
    let s = b.get(off..off + 4)?;
    Some(if le {
        u32::from_le_bytes([s[0], s[1], s[2], s[3]])
    } else {
        u32::from_be_bytes([s[0], s[1], s[2], s[3]])
    })
}
fn push_u16(out: &mut Vec<u8>, v: u16, le: bool) {
    out.extend_from_slice(&if le { v.to_le_bytes() } else { v.to_be_bytes() });
}
fn push_u32(out: &mut Vec<u8>, v: u32, le: bool) {
    out.extend_from_slice(&if le { v.to_le_bytes() } else { v.to_be_bytes() });
}
fn inline_u32(v: u32, le: bool) -> [u8; 4] {
    if le { v.to_le_bytes() } else { v.to_be_bytes() }
}

fn tiff_byte_order(tiff: &[u8]) -> Option<bool> {
    if tiff.len() < 8 {
        return None;
    }
    match &tiff[0..2] {
        b"II" => Some(true),
        b"MM" => Some(false),
        _ => None,
    }
}

fn tiff_type_size(ty: u16) -> Option<usize> {
    match ty {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 => Some(4),
        5 | 10 | 12 => Some(8),
        _ => None,
    }
}

/// Parses one IFD, resolving every entry's value bytes (inline or via
/// offset) eagerly so callers never need to re-touch the source buffer.
/// Bails (None) on anything out of bounds or overflowing rather than guess.
fn parse_ifd(tiff: &[u8], le: bool, offset: usize) -> Option<Vec<TiffEntry>> {
    let count = read_u16(tiff, offset, le)? as usize;
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let entry_off = offset + 2 + i * 12;
        let tag = read_u16(tiff, entry_off, le)?;
        let ty = read_u16(tiff, entry_off + 2, le)?;
        let cnt = read_u32(tiff, entry_off + 4, le)?;
        let type_size = tiff_type_size(ty)?;
        let total = type_size.checked_mul(cnt as usize)?;
        let data = if total <= 4 {
            tiff.get(entry_off + 8..entry_off + 8 + total)?.to_vec()
        } else {
            let voff = read_u32(tiff, entry_off + 8, le)? as usize;
            tiff.get(voff..voff.checked_add(total)?)?.to_vec()
        };
        entries.push(TiffEntry { tag, ty, count: cnt, data });
    }
    Some(entries)
}

fn find_entry(entries: &[TiffEntry], tag: u16) -> Option<&TiffEntry> {
    entries.iter().find(|e| e.tag == tag)
}

fn ascii_value(e: &TiffEntry) -> String {
    let end = e.data.iter().position(|&b| b == 0).unwrap_or(e.data.len());
    String::from_utf8_lossy(&e.data[..end]).trim().to_string()
}

fn rational_to_f64(bytes: &[u8], le: bool) -> Option<f64> {
    let num = read_u32(bytes, 0, le)? as f64;
    let den = read_u32(bytes, 4, le)? as f64;
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}

fn decode_gps(gps: &[TiffEntry], le: bool) -> Option<String> {
    let lat_ref = find_entry(gps, 0x0001).map(ascii_value)?;
    let lat = find_entry(gps, 0x0002)?;
    let lon_ref = find_entry(gps, 0x0003).map(ascii_value)?;
    let lon = find_entry(gps, 0x0004)?;
    let to_deg = |e: &TiffEntry| -> Option<f64> {
        if e.data.len() < 24 {
            return None;
        }
        let d = rational_to_f64(&e.data[0..8], le)?;
        let m = rational_to_f64(&e.data[8..16], le)?;
        let s = rational_to_f64(&e.data[16..24], le)?;
        Some(d + m / 60.0 + s / 3600.0)
    };
    let lat_deg = to_deg(lat)?;
    let lon_deg = to_deg(lon)?;
    Some(format!("{lat_deg:.5}\u{b0} {lat_ref}, {lon_deg:.5}\u{b0} {lon_ref}"))
}

const TAG_MAKE: u16 = 0x010F;
const TAG_MODEL: u16 = 0x0110;
const TAG_SOFTWARE: u16 = 0x0131;
const TAG_DATETIME: u16 = 0x0132;
const TAG_EXIF_SUBIFD: u16 = 0x8769;
const TAG_GPS_IFD: u16 = 0x8825;
const TAG_DATETIME_ORIGINAL: u16 = 0x9003;
const TAG_DATETIME_DIGITIZED: u16 = 0x9004;

/// Reads a TIFF/Exif byte stream (starting at "II"/"MM", no "Exif\0\0"
/// prefix) into a human-readable field list. Read-only — never mutates.
fn describe_tiff(tiff: &[u8]) -> Option<Vec<MetaField>> {
    let le = tiff_byte_order(tiff)?;
    let ifd0_offset = read_u32(tiff, 4, le)? as usize;
    let ifd0 = parse_ifd(tiff, le, ifd0_offset)?;

    let mut fields = Vec::new();

    let make = find_entry(&ifd0, TAG_MAKE).map(ascii_value);
    let model = find_entry(&ifd0, TAG_MODEL).map(ascii_value);
    let camera = [make, model].into_iter().flatten().collect::<Vec<_>>().join(" ");
    if !camera.trim().is_empty() {
        fields.push(MetaField { id: "camera".into(), label: "Model aparatu".into(), value: camera.trim().to_string() });
    }

    if let Some(sw) = find_entry(&ifd0, TAG_SOFTWARE).map(ascii_value) {
        if !sw.is_empty() {
            fields.push(MetaField { id: "software".into(), label: "Oprogramowanie".into(), value: sw });
        }
    }

    let exif_sub = find_entry(&ifd0, TAG_EXIF_SUBIFD)
        .and_then(|e| read_u32(&e.data, 0, le))
        .and_then(|off| parse_ifd(tiff, le, off as usize));

    let mut datetime = find_entry(&ifd0, TAG_DATETIME).map(ascii_value);
    if let Some(sub) = &exif_sub {
        if let Some(dto) = find_entry(sub, TAG_DATETIME_ORIGINAL).map(ascii_value) {
            datetime = Some(dto);
        } else if datetime.is_none() {
            datetime = find_entry(sub, TAG_DATETIME_DIGITIZED).map(ascii_value);
        }
    }
    if let Some(dt) = datetime {
        if !dt.is_empty() {
            fields.push(MetaField { id: "datetime".into(), label: "Data wykonania".into(), value: dt });
        }
    }

    let gps_ifd = find_entry(&ifd0, TAG_GPS_IFD)
        .and_then(|e| read_u32(&e.data, 0, le))
        .and_then(|off| parse_ifd(tiff, le, off as usize));
    if let Some(gps) = &gps_ifd {
        let value = decode_gps(gps, le).unwrap_or_else(|| "obecne (nie udało się odczytać współrzędnych)".into());
        fields.push(MetaField { id: "gps".into(), label: "Lokalizacja GPS".into(), value });
    }

    let mut other_count = ifd0
        .iter()
        .filter(|e| !matches!(e.tag, TAG_MAKE | TAG_MODEL | TAG_SOFTWARE | TAG_DATETIME | TAG_EXIF_SUBIFD | TAG_GPS_IFD))
        .count();
    if let Some(sub) = &exif_sub {
        other_count += sub.iter().filter(|e| !matches!(e.tag, TAG_DATETIME_ORIGINAL | TAG_DATETIME_DIGITIZED)).count();
    }
    if other_count > 0 {
        fields.push(MetaField { id: "other_exif".into(), label: "Pozostałe dane EXIF".into(), value: format!("{other_count} innych pól") });
    }

    Some(fields)
}

/// Rebuilds a TIFF/Exif byte stream keeping only the entries whose field id
/// is in `keep`. Returns:
///   None            -> unsafe to rewrite (unexpected structure); caller
///                       should leave the original bytes untouched.
///   Some(None)       -> nothing survives the filter; caller should drop the
///                       whole container (segment/chunk).
///   Some(Some(bytes)) -> the rebuilt TIFF.
fn rebuild_tiff(tiff: &[u8], keep: &HashSet<String>) -> Option<Option<Vec<u8>>> {
    let le = tiff_byte_order(tiff)?;
    let ifd0_offset = read_u32(tiff, 4, le)? as usize;
    let ifd0 = parse_ifd(tiff, le, ifd0_offset)?;

    let exif_sub_entry = find_entry(&ifd0, TAG_EXIF_SUBIFD).cloned();
    let exif_sub = match &exif_sub_entry {
        Some(e) => {
            let off = read_u32(&e.data, 0, le)?;
            let parsed = parse_ifd(tiff, le, off as usize)?;
            Some(parsed)
        }
        None => None,
    };
    let gps_entry = find_entry(&ifd0, TAG_GPS_IFD).cloned();
    let gps_ifd = match &gps_entry {
        Some(e) => {
            let off = read_u32(&e.data, 0, le)?;
            let parsed = parse_ifd(tiff, le, off as usize)?;
            Some(parsed)
        }
        None => None,
    };

    let kept_ifd0: Vec<TiffEntry> = ifd0
        .iter()
        .filter(|e| {
            let field = match e.tag {
                TAG_EXIF_SUBIFD | TAG_GPS_IFD => return false, // handled separately below
                TAG_MAKE | TAG_MODEL => "camera",
                TAG_SOFTWARE => "software",
                TAG_DATETIME => "datetime",
                _ => "other_exif",
            };
            keep.contains(field)
        })
        .cloned()
        .collect();

    let kept_exif_sub: Vec<TiffEntry> = exif_sub
        .as_ref()
        .map(|sub| {
            sub.iter()
                .filter(|e| {
                    let field = match e.tag {
                        TAG_DATETIME_ORIGINAL | TAG_DATETIME_DIGITIZED => "datetime",
                        _ => "other_exif",
                    };
                    keep.contains(field)
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    let kept_gps: Vec<TiffEntry> = if keep.contains("gps") { gps_ifd.unwrap_or_default() } else { Vec::new() };

    let has_exif_sub = !kept_exif_sub.is_empty();
    let has_gps = !kept_gps.is_empty();

    if kept_ifd0.is_empty() && !has_exif_sub && !has_gps {
        return Some(None);
    }

    let ifd0_entry_count = kept_ifd0.len() + has_exif_sub as usize + has_gps as usize;
    let ifd0_table_size = 2 + ifd0_entry_count * 12 + 4;
    let exif_table_size = if has_exif_sub { 2 + kept_exif_sub.len() * 12 + 4 } else { 0 };
    let gps_table_size = if has_gps { 2 + kept_gps.len() * 12 + 4 } else { 0 };

    let ifd0_table_start = 8usize;
    let exif_table_start = ifd0_table_start + ifd0_table_size;
    let gps_table_start = exif_table_start + exif_table_size;
    let extra_start = gps_table_start + gps_table_size;

    let mut extra: Vec<u8> = Vec::new();
    let mut extra_off = extra_start;

    let lay = |entries: &[TiffEntry], extra: &mut Vec<u8>, extra_off: &mut usize| -> Vec<(u16, u16, u32, [u8; 4])> {
        entries
            .iter()
            .map(|e| {
                let mut vf = [0u8; 4];
                if e.data.len() <= 4 {
                    vf[..e.data.len()].copy_from_slice(&e.data);
                } else {
                    vf = inline_u32(*extra_off as u32, le);
                    extra.extend_from_slice(&e.data);
                    *extra_off += e.data.len();
                }
                (e.tag, e.ty, e.count, vf)
            })
            .collect()
    };

    let mut ifd0_laid = lay(&kept_ifd0, &mut extra, &mut extra_off);
    let exif_laid = if has_exif_sub { lay(&kept_exif_sub, &mut extra, &mut extra_off) } else { Vec::new() };
    let gps_laid = if has_gps { lay(&kept_gps, &mut extra, &mut extra_off) } else { Vec::new() };

    if has_exif_sub {
        ifd0_laid.push((TAG_EXIF_SUBIFD, 4, 1, inline_u32(exif_table_start as u32, le)));
    }
    if has_gps {
        ifd0_laid.push((TAG_GPS_IFD, 4, 1, inline_u32(gps_table_start as u32, le)));
    }
    ifd0_laid.sort_by_key(|e| e.0); // TIFF requires entries sorted by tag

    let write_ifd_table = |out: &mut Vec<u8>, entries: &[(u16, u16, u32, [u8; 4])], le: bool| {
        push_u16(out, entries.len() as u16, le);
        for (tag, ty, count, vf) in entries {
            push_u16(out, *tag, le);
            push_u16(out, *ty, le);
            push_u32(out, *count, le);
            out.extend_from_slice(vf);
        }
        push_u32(out, 0, le); // next IFD offset — always none, we never chain
    };

    let mut out = Vec::with_capacity(extra_start + extra.len());
    out.extend_from_slice(if le { b"II" } else { b"MM" });
    push_u16(&mut out, 42, le);
    push_u32(&mut out, ifd0_table_start as u32, le);
    write_ifd_table(&mut out, &ifd0_laid, le);
    if has_exif_sub {
        write_ifd_table(&mut out, &exif_laid, le);
    }
    if has_gps {
        write_ifd_table(&mut out, &gps_laid, le);
    }
    out.extend_from_slice(&extra);

    Some(Some(out))
}

// -------------------------------------------------------------------- JPEG

#[derive(Clone, Copy, PartialEq)]
enum SegKind {
    Keep,
    ExifTiff,
    Xmp,
    Photoshop,
    Comment,
    UnknownApp,
}

struct JpegSeg {
    kind: SegKind,
    range: (usize, usize),
    payload: (usize, usize),
}

struct JpegLayout {
    segs: Vec<JpegSeg>,
    tail_start: usize,
}

const XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";

fn layout_jpeg(data: &[u8]) -> Option<JpegLayout> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    let mut segs = Vec::new();
    let mut pos = 2usize;
    let tail_start;
    loop {
        if pos + 1 >= data.len() {
            tail_start = pos;
            break;
        }
        if data[pos] != 0xFF {
            tail_start = pos;
            break;
        }
        let marker = data[pos + 1];

        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            segs.push(JpegSeg { kind: SegKind::Keep, range: (pos, pos + 2), payload: (pos + 2, pos + 2) });
            pos += 2;
            continue;
        }
        if marker == 0xD9 {
            segs.push(JpegSeg { kind: SegKind::Keep, range: (pos, pos + 2), payload: (pos + 2, pos + 2) });
            pos += 2;
            tail_start = pos;
            break;
        }
        if pos + 4 > data.len() {
            tail_start = pos;
            break;
        }
        let seg_len = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
        if seg_len < 2 || pos + 2 + seg_len > data.len() {
            tail_start = pos;
            break;
        }
        let payload_start = pos + 4;
        let payload_end = pos + 2 + seg_len;
        let payload = &data[payload_start..payload_end];

        let kind = if marker == 0xE1 && payload.starts_with(b"Exif\0\0") {
            SegKind::ExifTiff
        } else if marker == 0xE1 && payload.starts_with(XMP_PREFIX) {
            SegKind::Xmp
        } else if marker == 0xE1 {
            SegKind::UnknownApp
        } else if marker == 0xED {
            SegKind::Photoshop
        } else if marker == 0xFE {
            SegKind::Comment
        } else {
            SegKind::Keep
        };
        segs.push(JpegSeg { kind, range: (pos, payload_end), payload: (payload_start, payload_end) });
        pos = payload_end;

        if marker == 0xDA {
            tail_start = pos;
            break;
        }
    }
    Some(JpegLayout { segs, tail_start })
}

fn inspect_jpeg(data: &[u8]) -> Option<(Vec<MetaField>, u64)> {
    let layout = layout_jpeg(data)?;
    let mut fields = Vec::new();
    let mut strippable = 0u64;
    for seg in &layout.segs {
        let (s, e) = seg.range;
        let (ps, pe) = seg.payload;
        match seg.kind {
            SegKind::Keep => {}
            SegKind::ExifTiff => {
                if let Some(sub) = describe_tiff(&data[ps + 6..pe]) {
                    fields.extend(sub);
                }
                strippable += (e - s) as u64;
            }
            SegKind::Xmp => {
                let text = String::from_utf8_lossy(&data[ps + XMP_PREFIX.len()..pe]);
                fields.push(MetaField { id: "xmp".into(), label: "XMP".into(), value: truncate(&text, 300) });
                strippable += (e - s) as u64;
            }
            SegKind::Photoshop => {
                fields.push(MetaField { id: "photoshop".into(), label: "Dane Photoshop / IPTC".into(), value: format!("obecne ({} B)", e - s) });
                strippable += (e - s) as u64;
            }
            SegKind::Comment => {
                let text = String::from_utf8_lossy(&data[ps..pe]);
                fields.push(MetaField { id: "comment".into(), label: "Komentarz".into(), value: truncate(&text, 300) });
                strippable += (e - s) as u64;
            }
            SegKind::UnknownApp => {
                fields.push(MetaField { id: "unknown".into(), label: "Nierozpoznane dane".into(), value: format!("obecne ({} B)", e - s) });
                strippable += (e - s) as u64;
            }
        }
    }
    Some((fields, strippable))
}

fn clean_jpeg(data: &[u8], keep: &HashSet<String>) -> Option<(Vec<u8>, u64, Vec<String>)> {
    let layout = layout_jpeg(data)?;
    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(&data[0..2]); // SOI — layout_jpeg starts parsing markers after it
    let mut freed = 0u64;
    let mut removed_labels: Vec<String> = Vec::new();

    for seg in &layout.segs {
        let (s, e) = seg.range;
        match seg.kind {
            SegKind::Keep => out.extend_from_slice(&data[s..e]),
            SegKind::ExifTiff => {
                let (ps, pe) = seg.payload;
                let tiff = &data[ps + 6..pe];
                let found = describe_tiff(tiff).unwrap_or_default();
                let found_ids: HashSet<String> = found.iter().map(|f| f.id.clone()).collect();

                if found_ids.iter().all(|id| keep.contains(id)) {
                    out.extend_from_slice(&data[s..e]);
                } else if found_ids.iter().all(|id| !keep.contains(id)) {
                    freed += (e - s) as u64;
                    removed_labels.extend(found.into_iter().map(|f| f.label));
                } else {
                    match rebuild_tiff(tiff, keep) {
                        Some(Some(new_tiff)) => {
                            let mut seg_bytes = Vec::with_capacity(10 + new_tiff.len());
                            seg_bytes.push(0xFF);
                            seg_bytes.push(0xE1);
                            let len = (2 + 6 + new_tiff.len()) as u16;
                            seg_bytes.extend_from_slice(&len.to_be_bytes());
                            seg_bytes.extend_from_slice(b"Exif\0\0");
                            seg_bytes.extend_from_slice(&new_tiff);
                            freed += ((e - s) as u64).saturating_sub(seg_bytes.len() as u64);
                            removed_labels.extend(found.into_iter().filter(|f| !keep.contains(&f.id)).map(|f| f.label));
                            out.extend_from_slice(&seg_bytes);
                        }
                        Some(None) => {
                            freed += (e - s) as u64;
                            removed_labels.extend(found.into_iter().map(|f| f.label));
                        }
                        None => out.extend_from_slice(&data[s..e]),
                    }
                }
            }
            SegKind::Xmp | SegKind::Photoshop | SegKind::Comment | SegKind::UnknownApp => {
                let (id, label) = match seg.kind {
                    SegKind::Xmp => ("xmp", "XMP"),
                    SegKind::Photoshop => ("photoshop", "Dane Photoshop / IPTC"),
                    SegKind::Comment => ("comment", "Komentarz"),
                    _ => ("unknown", "Nierozpoznane dane"),
                };
                if keep.contains(id) {
                    out.extend_from_slice(&data[s..e]);
                } else {
                    freed += (e - s) as u64;
                    removed_labels.push(label.to_string());
                }
            }
        }
    }
    out.extend_from_slice(&data[layout.tail_start..]);
    Some((out, freed, removed_labels))
}

// --------------------------------------------------------------------- PNG

fn layout_png(data: &[u8]) -> Option<Vec<(usize, usize, [u8; 4])>> {
    if data.len() < 8 || &data[0..8] != PNG_SIG {
        return None;
    }
    let mut chunks = Vec::new();
    let mut pos = 8usize;
    while pos + 8 <= data.len() {
        let len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        let ctype: [u8; 4] = data[pos + 4..pos + 8].try_into().ok()?;
        let total = 12 + len;
        if pos + total > data.len() {
            break;
        }
        chunks.push((pos, pos + total, ctype));
        pos += total;
        if &ctype == b"IEND" {
            break;
        }
    }
    Some(chunks)
}

fn split_null(b: &[u8]) -> Option<(&[u8], &[u8])> {
    let pos = b.iter().position(|&x| x == 0)?;
    Some((&b[..pos], &b[pos + 1..]))
}

fn latin1_to_string(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

fn inflate(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut decoder = flate2::read::ZlibDecoder::new(bytes);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).ok()?;
    Some(out)
}

/// Decodes a tEXt/zTXt/iTXt chunk payload into (keyword, text).
fn decode_text_chunk(ctype: &[u8], payload: &[u8]) -> Option<(String, String)> {
    match ctype {
        b"tEXt" => {
            let (kw, text) = split_null(payload)?;
            Some((latin1_to_string(kw), latin1_to_string(text)))
        }
        b"zTXt" => {
            let (kw, rest) = split_null(payload)?;
            let compressed = rest.get(1..)?; // rest[0] is the compression method (always 0=zlib)
            let out = inflate(compressed)?;
            Some((latin1_to_string(kw), latin1_to_string(&out)))
        }
        b"iTXt" => {
            let (kw, rest) = split_null(payload)?;
            let flag = *rest.first()?;
            let rest = rest.get(2..)?; // skip compression flag + method
            let (_lang, rest) = split_null(rest)?;
            let (_translated, text_bytes) = split_null(rest)?;
            let text = if flag != 0 {
                String::from_utf8_lossy(&inflate(text_bytes)?).into_owned()
            } else {
                String::from_utf8_lossy(text_bytes).into_owned()
            };
            Some((latin1_to_string(kw), text))
        }
        _ => None,
    }
}

const PNG_TEXT_TYPES: [&[u8; 4]; 3] = [b"tEXt", b"zTXt", b"iTXt"];

fn text_field_id_label(ctype: &[u8], payload: &[u8]) -> (String, String) {
    match decode_text_chunk(ctype, payload) {
        Some((kw, _)) if kw == "XML:com.adobe.xmp" => ("xmp".to_string(), "XMP".to_string()),
        Some((kw, _)) => (format!("text:{kw}"), kw),
        None => ("unknown".to_string(), "Nierozpoznane dane tekstowe".to_string()),
    }
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn inspect_png(data: &[u8]) -> Option<(Vec<MetaField>, u64)> {
    let chunks = layout_png(data)?;
    let mut fields = Vec::new();
    let mut strippable = 0u64;
    for (s, e, ctype) in &chunks {
        let payload = &data[s + 8..e - 4];
        if ctype == b"eXIf" {
            if let Some(sub) = describe_tiff(payload) {
                fields.extend(sub);
            }
            strippable += (e - s) as u64;
        } else if PNG_TEXT_TYPES.contains(&ctype) {
            let (id, label) = text_field_id_label(ctype, payload);
            let value = decode_text_chunk(ctype, payload).map(|(_, t)| truncate(&t, 300)).unwrap_or_else(|| format!("obecne ({} B)", e - s));
            fields.push(MetaField { id, label, value });
            strippable += (e - s) as u64;
        }
    }
    Some((fields, strippable))
}

fn clean_png(data: &[u8], keep: &HashSet<String>) -> Option<(Vec<u8>, u64, Vec<String>)> {
    let chunks = layout_png(data)?;
    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(&data[0..8]);
    let mut freed = 0u64;
    let mut removed_labels = Vec::new();

    for (s, e, ctype) in &chunks {
        let (s, e) = (*s, *e);
        if ctype == b"eXIf" {
            let payload = &data[s + 8..e - 4];
            let found = describe_tiff(payload).unwrap_or_default();
            let found_ids: HashSet<String> = found.iter().map(|f| f.id.clone()).collect();

            if found_ids.iter().all(|id| keep.contains(id)) {
                out.extend_from_slice(&data[s..e]);
            } else if found_ids.iter().all(|id| !keep.contains(id)) {
                freed += (e - s) as u64;
                removed_labels.extend(found.into_iter().map(|f| f.label));
            } else {
                match rebuild_tiff(payload, keep) {
                    Some(Some(new_tiff)) => {
                        let mut chunk = Vec::with_capacity(12 + new_tiff.len());
                        chunk.extend_from_slice(&(new_tiff.len() as u32).to_be_bytes());
                        chunk.extend_from_slice(b"eXIf");
                        chunk.extend_from_slice(&new_tiff);
                        let crc = crc32(&chunk[4..]);
                        chunk.extend_from_slice(&crc.to_be_bytes());
                        freed += ((e - s) as u64).saturating_sub(chunk.len() as u64);
                        removed_labels.extend(found.into_iter().filter(|f| !keep.contains(&f.id)).map(|f| f.label));
                        out.extend_from_slice(&chunk);
                    }
                    Some(None) => {
                        freed += (e - s) as u64;
                        removed_labels.extend(found.into_iter().map(|f| f.label));
                    }
                    None => out.extend_from_slice(&data[s..e]),
                }
            }
        } else if PNG_TEXT_TYPES.contains(&ctype) {
            let payload = &data[s + 8..e - 4];
            let (id, label) = text_field_id_label(ctype, payload);
            if keep.contains(&id) {
                out.extend_from_slice(&data[s..e]);
            } else {
                freed += (e - s) as u64;
                removed_labels.push(label);
            }
        } else {
            out.extend_from_slice(&data[s..e]);
        }
    }
    Some((out, freed, removed_labels))
}

// ------------------------------------------------------------------ shared

fn inspect_one(path: &str) -> FileInfo {
    let mut info = FileInfo { path: path.to_string(), ..Default::default() };
    let data = match fs::read(path) {
        Ok(d) => d,
        Err(e) => {
            info.error = Some(e.to_string());
            return info;
        }
    };
    info.size = data.len() as u64;
    if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
        info.format = "jpeg".into();
        if let Some((fields, bytes)) = inspect_jpeg(&data) {
            info.supported = true;
            info.metadata_bytes = bytes;
            info.fields = fields;
        }
    } else if data.len() >= 8 && &data[0..8] == PNG_SIG {
        info.format = "png".into();
        if let Some((fields, bytes)) = inspect_png(&data) {
            info.supported = true;
            info.metadata_bytes = bytes;
            info.fields = fields;
        }
    } else {
        info.format = "unsupported".into();
    }
    info
}

fn clean_one(item: &CleanItem) -> CleanEntry {
    let mut entry = CleanEntry { path: item.path.clone(), cleaned: false, freed_bytes: 0, removed_fields: Vec::new(), error: None };
    let data = match fs::read(&item.path) {
        Ok(d) => d,
        Err(e) => {
            entry.error = Some(e.to_string());
            return entry;
        }
    };
    let keep: HashSet<String> = item.keep_fields.iter().cloned().collect();

    let result = if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
        clean_jpeg(&data, &keep)
    } else if data.len() >= 8 && &data[0..8] == PNG_SIG {
        clean_png(&data, &keep)
    } else {
        None
    };

    let Some((output, freed, removed_labels)) = result else {
        entry.error = Some("nieobsługiwany format (obsługiwane: JPEG, PNG)".into());
        return entry;
    };

    if freed == 0 {
        entry.cleaned = true;
        return entry;
    }

    match write_atomic(&item.path, &output) {
        Ok(()) => {
            entry.cleaned = true;
            entry.freed_bytes = freed;
            entry.removed_fields = removed_labels;
        }
        Err(e) => entry.error = Some(e.to_string()),
    }
    entry
}

/// Writes via a sibling temp file + rename instead of overwriting in place.
/// `fs::write` truncates the destination before writing, so an interruption
/// (disk full, crash, power loss) mid-write would leave the user's original
/// photo truncated and unrecoverable — this module edits irreplaceable
/// personal files, so a failed clean must leave the original untouched.
/// The temp file is a sibling (same directory) so the rename stays on one
/// filesystem, which is what makes it atomic.
fn write_atomic(path: &str, data: &[u8]) -> io::Result<()> {
    let target = Path::new(path);
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    let file_name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "plik".into());
    let tmp = dir.join(format!(".{file_name}.posma-tmp"));

    let original_perms = fs::metadata(target).map(|m| m.permissions()).ok();

    let write_result = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()
    })();
    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    if let Some(perms) = original_perms {
        let _ = fs::set_permissions(&tmp, perms);
    }

    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn inspect(paths: Vec<String>) -> Vec<FileInfo> {
    paths.iter().map(|p| inspect_one(p)).collect()
}

fn clean(items: Vec<CleanItem>) -> CleanResult {
    let entries: Vec<CleanEntry> = items.iter().map(clean_one).collect();
    let total_freed = entries.iter().map(|e| e.freed_bytes).sum();
    CleanResult { entries, total_freed }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Inspect { paths }) => serde_json::to_string(&ok(inspect(paths))),
            Ok(Request::Clean { items }) => serde_json::to_string(&ok(clean(items))),
            Err(e) => serde_json::to_string(&Response::<()>::Err {
                ok: false,
                error: format!("invalid request: {e}"),
            }),
        },
        Err(e) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: format!("failed to read stdin: {e}"),
        }),
    };
    println!("{}", output.expect("response must serialize"));
    io::stdout().flush().ok();
}
