//! xcode-cache sidecar: what Xcode leaves behind, and how much of the disk
//! it is holding. The protocol and the checks live in `library-clean`;
//! this is the list of places.
//!
//! Xcode's own directory mixes things that regenerate on the next build
//! with things that cannot be recovered at all, and they sit side by side
//! under the same parent. So the list is fixed rather than a walk of
//! `~/Library/Developer`, because that directory also holds `UserData` —
//! code snippets, key bindings, window layouts — which is the user's own
//! work and must never appear in a list headed "what can I delete".

use library_clean::{Location, Recovery};

const LOCATIONS: &[Location] = &[
    Location {
        id: "derived-data",
        name: "DerivedData",
        note: "Wyniki kompilacji. Odbudowują się przy następnym budowaniu projektu — pierwsze potrwa dłużej.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Developer/Xcode/DerivedData",
        per_child: true,
    },
    Location {
        id: "device-support",
        name: "Symbole urządzeń iOS",
        note: "Pobierane przy pierwszym podłączeniu urządzenia z danym systemem. Wrócą przy kolejnym podłączeniu.",
        recovery: Recovery::Refetched,
        relative: "Library/Developer/Xcode/iOS DeviceSupport",
        per_child: true,
    },
    Location {
        id: "watchos-support",
        name: "Symbole urządzeń watchOS",
        note: "Jak wyżej, dla zegarków.",
        recovery: Recovery::Refetched,
        relative: "Library/Developer/Xcode/watchOS DeviceSupport",
        per_child: true,
    },
    Location {
        id: "simulator-caches",
        name: "Cache symulatorów",
        note: "Odtwarzane przez CoreSimulator na żądanie.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Developer/CoreSimulator/Caches",
        per_child: false,
    },
    Location {
        id: "xcode-caches",
        name: "Cache aplikacji Xcode",
        note: "Wewnętrzny cache samego Xcode.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Caches/com.apple.dt.Xcode",
        per_child: false,
    },
    Location {
        id: "archives",
        name: "Archiwa",
        note: "Wydania spakowane do dystrybucji. Trzymają symbole potrzebne do odczytania raportów o awariach z Twoich wydanych aplikacji — po usunięciu nie da się ich odtworzyć.",
        recovery: Recovery::Permanent,
        relative: "Library/Developer/Xcode/Archives",
        per_child: true,
    },
];

fn main() {
    library_clean::serve(LOCATIONS, &["Library/Developer/Xcode"]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_is_well_formed() {
        library_clean::assert_well_formed(LOCATIONS);
    }

    /// UserData holds snippets, key bindings and window layouts. It sits
    /// beside DerivedData under the same parent, and listing it would offer
    /// the user their own work as rubbish.
    #[test]
    fn user_data_is_not_a_known_location() {
        assert!(!LOCATIONS.iter().any(|l| l.relative.contains("UserData")), "UserData must never be offered");
    }

    /// Archives cannot be rebuilt; anything claiming otherwise would be
    /// presented as free to reclaim.
    #[test]
    fn archives_are_marked_unrecoverable() {
        let archives = LOCATIONS.iter().find(|l| l.id == "archives").expect("archives listed");
        assert_eq!(archives.recovery, Recovery::Permanent);
    }
}
