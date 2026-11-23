//! Request guard against cross-site requests and DNS rebinding (ADR-0034).

use actix_web::body::MessageBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::{header, Method};
use actix_web::middleware::Next;
use actix_web::web;

/// Host names a request may address (`Host`) or come from (`Origin`).
#[derive(Clone, Debug)]
pub enum AllowedHosts {
    /// Any `Host`; mutations still need a same-host or listed `Origin`.
    Any,
    /// Lower-case host names without port or IPv6 brackets.
    List(Vec<String>),
}

fn loopback_list() -> Vec<String> {
    ["localhost", "127.0.0.1", "::1"].map(String::from).to_vec()
}

impl AllowedHosts {
    /// Only loopback names (desktop mode).
    pub fn loopback() -> Self {
        Self::List(loopback_list())
    }

    /// Web mode: loopback plus `ALLOWED_HOSTS` (comma-separated, `*` = any).
    /// Unset, a concrete bind address adds itself and `0.0.0.0`/`::` allow any `Host`.
    pub fn for_web(bind_host: &str, env: Option<&str>) -> Self {
        let extra: Vec<String> = match env.map(str::trim).filter(|s| !s.is_empty()) {
            Some(v) => v
                .split(',')
                .map(normalize)
                .filter(|h| !h.is_empty())
                .collect(),
            None => vec![normalize(bind_host)],
        };
        if extra
            .iter()
            .any(|h| h == "*" || env.is_none() && (h == "0.0.0.0" || h == "::"))
        {
            return Self::Any;
        }
        let mut list = loopback_list();
        for h in extra {
            if !list.contains(&h) {
                list.push(h);
            }
        }
        Self::List(list)
    }

    fn contains(&self, host: &str) -> bool {
        match self {
            Self::Any => true,
            Self::List(l) => l.iter().any(|h| h == host),
        }
    }
}

fn normalize(host: &str) -> String {
    host.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase()
}

/// Host name of a `Host` header value (`name[:port]`, `[v6][:port]`).
fn host_name(authority: &str) -> String {
    let a = authority.trim();
    let name = match a.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => a.rsplit_once(':').map_or(a, |(h, _)| h),
    };
    name.to_ascii_lowercase()
}

/// Host name of an `Origin` header value (`scheme://authority`); `None` for `null`/garbage.
fn origin_host(origin: &str) -> Option<String> {
    let (_, authority) = origin.trim().split_once("://")?;
    let name = host_name(authority);
    (!name.is_empty()).then_some(name)
}

/// Whether a request may proceed. A `Host` outside the allow-list is a DNS
/// rebinding attempt; a mutation with a foreign `Origin` is cross-site.
pub fn is_allowed(
    method: &Method,
    host: Option<&str>,
    origin: Option<&str>,
    allowed: &AllowedHosts,
) -> bool {
    let host = host.map(host_name);
    if let Some(h) = &host {
        if !allowed.contains(h) {
            return false;
        }
    }
    let safe = matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS);
    match origin {
        Some(o) if !safe => origin_host(o).is_some_and(|o| {
            host.as_deref() == Some(o.as_str())
                || matches!(allowed, AllowedHosts::List(_)) && allowed.contains(&o)
        }),
        _ => true,
    }
}

/// `middleware::from_fn` guard; reads `web::Data<AllowedHosts>` (loopback if absent).
pub async fn middleware(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, actix_web::Error> {
    let allowed = req
        .app_data::<web::Data<AllowedHosts>>()
        .map_or_else(AllowedHosts::loopback, |d| d.get_ref().clone());
    let h = req.headers();
    let get = |name| h.get(name).and_then(|v| v.to_str().ok());
    if !is_allowed(
        req.method(),
        get(header::HOST),
        get(header::ORIGIN),
        &allowed,
    ) {
        eprintln!(
            "[{}] REJECTED {} {} (host {:?}, origin {:?})",
            crate::log_timestamp(),
            req.method(),
            req.path(),
            get(header::HOST),
            get(header::ORIGIN)
        );
        return Err(actix_web::error::ErrorForbidden(
            "host or origin not allowed",
        ));
    }
    next.call(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lo() -> AllowedHosts {
        AllowedHosts::loopback()
    }

    #[test]
    fn host_names_parse() {
        assert_eq!(host_name("localhost:8080"), "localhost");
        assert_eq!(host_name("LOCALHOST"), "localhost");
        assert_eq!(host_name("[::1]:8080"), "::1");
        assert_eq!(host_name("[::1]"), "::1");
        assert_eq!(
            origin_host("http://127.0.0.1:3000"),
            Some("127.0.0.1".into())
        );
        assert_eq!(origin_host("https://[::1]"), Some("::1".into()));
        assert_eq!(origin_host("null"), None);
        assert_eq!(origin_host("http://"), None);
    }

    #[test]
    fn loopback_hosts_pass() {
        for h in [
            "localhost:8080",
            "127.0.0.1:8080",
            "[::1]:8080",
            "localhost",
        ] {
            assert!(is_allowed(&Method::GET, Some(h), None, &lo()), "{h}");
        }
    }

    #[test]
    fn rebinding_host_rejected() {
        assert!(!is_allowed(
            &Method::GET,
            Some("evil.example:8080"),
            None,
            &lo()
        ));
        assert!(!is_allowed(
            &Method::PUT,
            Some("evil.example:8080"),
            Some("http://evil.example:8080"),
            &lo()
        ));
        // Lookalikes are not loopback.
        assert!(!is_allowed(
            &Method::GET,
            Some("localhost.evil.example"),
            None,
            &lo()
        ));
        assert!(!is_allowed(
            &Method::GET,
            Some("127.0.0.1.nip.io"),
            None,
            &lo()
        ));
    }

    #[test]
    fn missing_host_passes() {
        assert!(is_allowed(&Method::GET, None, None, &lo()));
    }

    #[test]
    fn cross_site_mutation_rejected() {
        for m in [Method::POST, Method::PUT, Method::DELETE, Method::PATCH] {
            assert!(!is_allowed(
                &m,
                Some("localhost:8080"),
                Some("https://evil.example"),
                &lo()
            ));
            assert!(!is_allowed(&m, Some("localhost:8080"), Some("null"), &lo()));
        }
    }

    #[test]
    fn same_site_and_originless_mutations_pass() {
        assert!(is_allowed(
            &Method::PUT,
            Some("localhost:8080"),
            Some("http://localhost:8080"),
            &lo()
        ));
        // Vite dev proxy keeps the :3000 Host and Origin.
        assert!(is_allowed(
            &Method::POST,
            Some("localhost:3000"),
            Some("http://localhost:3000"),
            &lo()
        ));
        assert!(is_allowed(
            &Method::DELETE,
            Some("127.0.0.1:8080"),
            None,
            &lo()
        ));
    }

    #[test]
    fn foreign_origin_on_safe_method_passes() {
        // Without CORS the browser keeps the response from the foreign page.
        assert!(is_allowed(
            &Method::GET,
            Some("localhost:8080"),
            Some("https://evil.example"),
            &lo()
        ));
    }

    #[test]
    fn web_defaults() {
        assert!(matches!(
            AllowedHosts::for_web("0.0.0.0", None),
            AllowedHosts::Any
        ));
        assert!(matches!(
            AllowedHosts::for_web("::", None),
            AllowedHosts::Any
        ));
        let lo_bind = AllowedHosts::for_web("127.0.0.1", None);
        assert!(
            matches!(&lo_bind, AllowedHosts::List(l) if l.len() == 3),
            "{lo_bind:?}"
        );
        assert!(!lo_bind.contains("evil.example"));
        assert!(lo_bind.contains("localhost"));
        let lan = AllowedHosts::for_web("192.168.1.5", None);
        assert!(lan.contains("192.168.1.5"));
        assert!(!lan.contains("evil.example"));
        assert!(matches!(
            AllowedHosts::for_web("127.0.0.1", Some("")),
            AllowedHosts::List(_)
        ));
    }

    #[test]
    fn web_env_list() {
        let a = AllowedHosts::for_web("0.0.0.0", Some(" Kanban.Example.com , [fd00::1] ,"));
        assert!(a.contains("kanban.example.com"));
        assert!(a.contains("fd00::1"));
        assert!(a.contains("localhost"));
        assert!(!a.contains("0.0.0.0"));
        assert!(!a.contains("evil.example"));
        assert!(matches!(
            AllowedHosts::for_web("127.0.0.1", Some("a,*")),
            AllowedHosts::Any
        ));
    }

    #[test]
    fn any_hosts_still_require_same_origin_mutations() {
        let any = AllowedHosts::Any;
        assert!(is_allowed(&Method::GET, Some("nas:8080"), None, &any));
        assert!(is_allowed(
            &Method::PUT,
            Some("nas:8080"),
            Some("http://nas:8080"),
            &any
        ));
        assert!(!is_allowed(
            &Method::PUT,
            Some("nas:8080"),
            Some("https://evil.example"),
            &any
        ));
    }

    #[test]
    fn listed_origin_behind_rewriting_proxy_passes() {
        let a = AllowedHosts::for_web("0.0.0.0", Some("kanban.example.com,synkban"));
        assert!(is_allowed(
            &Method::PUT,
            Some("synkban:8080"),
            Some("https://kanban.example.com"),
            &a
        ));
    }
}
