//! The Windows services POSMA may switch, grouped the way the services
//! module offers them. The module lists them; the broker refuses every
//! other name, so a profile is a reviewed list rather than "any service".
//!
//! Switching one on puts back the start type Windows itself gives it, so
//! no start type ever comes from a request.

pub struct Service {
    pub name: &'static str,
    /// `sc config` wording: `auto`, `delayed-auto` or `demand`.
    pub default_start: &'static str,
}

pub struct Profile {
    pub id: &'static str,
    pub name: &'static str,
    /// What stops working while it is switched off — shown before asking.
    pub effect: &'static str,
    pub services: &'static [Service],
}

pub const PROFILES: &[Profile] = &[
    Profile {
        id: "telemetry",
        name: "Telemetria",
        effect: "Windows przestaje wysyłać dane diagnostyczne. Centrum opinii może przestać działać.",
        services: &[
            Service { name: "DiagTrack", default_start: "auto" },
            Service { name: "dmwappushservice", default_start: "demand" },
        ],
    },
    Profile {
        id: "xbox",
        name: "Xbox",
        effect: "Przestają działać logowanie do Xbox Live, zapisy gier w chmurze i aktualizacje padów Xbox.",
        services: &[
            Service { name: "XblAuthManager", default_start: "demand" },
            Service { name: "XblGameSave", default_start: "demand" },
            Service { name: "XboxNetApiSvc", default_start: "demand" },
            Service { name: "XboxGipSvc", default_start: "demand" },
        ],
    },
    Profile {
        id: "print",
        name: "Drukowanie i faks",
        effect: "Nie da się drukować — również do PDF przez „Microsoft Print to PDF” — ani wysyłać faksów.",
        services: &[
            Service { name: "Spooler", default_start: "auto" },
            Service { name: "Fax", default_start: "demand" },
        ],
    },
    Profile {
        id: "maps",
        name: "Mapy offline",
        effect: "Aplikacja Mapy nie pobiera ani nie aktualizuje map offline.",
        services: &[Service { name: "MapsBroker", default_start: "delayed-auto" }],
    },
];

/// The listed service called `name`, matched as Windows matches service
/// names — without regard to case.
pub fn find(name: &str) -> Option<&'static Service> {
    PROFILES.iter().flat_map(|p| p.services).find(|s| s.name.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_services_are_found_and_each_once() {
        assert_eq!(find("diagtrack").map(|s| s.default_start), Some("auto"));
        assert!(find("WinDefend").is_none() && find("").is_none());
        let names: Vec<&str> = PROFILES.iter().flat_map(|p| p.services).map(|s| s.name).collect();
        let unique: std::collections::HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
        assert_eq!(names.len(), unique.len(), "a service in two profiles would be switched by both");
        assert!(PROFILES.iter().flat_map(|p| p.services).all(|s| ["auto", "delayed-auto", "demand"].contains(&s.default_start)));
    }
}
