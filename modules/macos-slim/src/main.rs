//! macos-slim sidecar: what Mail and Messages keep on disk that comes back
//! by itself. The protocol and the checks live in `library-clean`; this is
//! the list of places.
//!
//! Left out on purpose:
//!  - `~/Library/Messages/Attachments`. Those files are the conversations
//!    themselves, and the Messages database still points at them; deleting
//!    them behind its back leaves holes in every thread. Shrinking them is
//!    for Messages' own "Review attachments", which updates the database.
//!  - `~/Library/Mail`. Under POP the attachments there are the only copy,
//!    and telling a POP account from an IMAP one means reading Mail's
//!    account files — not something to guess at.
//!
//! Every place here sits behind Full Disk Access; without it macOS refuses
//! to list them, and the scan reports them as blocked rather than empty.

use library_clean::{Location, Recovery};

const OPENED_ATTACHMENTS: &str = "Kopie załączników zapisane przy ich otwieraniu. Oryginał zostaje w wiadomości — przy następnym otwarciu Poczta zapisze kopię znowu. Przepadną tylko zmiany, które ktoś zapisał w takiej kopii zamiast w osobnym pliku.";

const LOCATIONS: &[Location] = &[
    Location {
        id: "mail-downloads",
        name: "Otwarte załączniki Poczty",
        note: OPENED_ATTACHMENTS,
        recovery: Recovery::Rebuilt,
        relative: "Library/Containers/com.apple.mail/Data/Library/Mail Downloads",
        per_child: false,
    },
    Location {
        id: "mail-downloads-legacy",
        name: "Otwarte załączniki Poczty (starsze macOS)",
        note: OPENED_ATTACHMENTS,
        recovery: Recovery::Rebuilt,
        relative: "Library/Mail Downloads",
        per_child: false,
    },
    Location {
        id: "mail-cache",
        name: "Cache Poczty",
        note: "Treści pobrane tylko do wyświetlenia. Poczta odtworzy je sama.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Containers/com.apple.mail/Data/Library/Caches/com.apple.mail",
        per_child: false,
    },
    Location {
        id: "messages-previews",
        name: "Podglądy w Wiadomościach",
        note: "Miniatury zdjęć i linków z rozmów. Same załączniki zostają; miniatury powstaną od nowa przy przewijaniu rozmowy.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Messages/Caches",
        per_child: false,
    },
    Location {
        id: "messages-cache",
        name: "Cache Wiadomości",
        note: "Wewnętrzny cache aplikacji Wiadomości.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Caches/com.apple.Messages",
        per_child: false,
    },
];

fn main() {
    library_clean::serve(LOCATIONS, &["Library/Mail", "Library/Messages", "Library/Containers/com.apple.mail"]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_is_well_formed() {
        library_clean::assert_well_formed(LOCATIONS);
    }

    /// The promise in the module's name: nothing here is content. A place
    /// that could not come back would need its own warning in the view.
    #[test]
    fn everything_listed_comes_back_by_itself() {
        assert!(LOCATIONS.iter().all(|l| l.recovery == Recovery::Rebuilt));
    }

    /// Mailboxes and conversations live right beside the caches.
    #[test]
    fn mailboxes_and_conversations_are_never_offered() {
        for l in LOCATIONS {
            assert!(!l.relative.contains("Attachments"), "{} reaches Messages' attachments", l.id);
            assert!(!l.relative.starts_with("Library/Mail/") && l.relative != "Library/Mail", "{} reaches the mailboxes", l.id);
            assert!(l.relative != "Library/Messages", "{} reaches the conversations", l.id);
        }
    }
}
