//! ProseMirror description schema validator (ADR-0015).
//!
//! Reads the canonical schema definition from `frontend/src/schema.json` at
//! compile time so the frontend editor (`frontend/src/schema.ts`) and backend
//! validation share a single source of truth and cannot diverge.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;

use crate::errors::AppError;

const SCHEMA_JSON: &str = include_str!("../../frontend/src/schema.json");

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSchema {
    #[serde(rename = "topNode")]
    top_node: String,
    #[serde(rename = "allowedLinkProtocols")]
    allowed_link_protocols: Vec<String>,
    #[serde(rename = "allowedAlignments")]
    allowed_alignments: Vec<String>,
    nodes: BTreeMap<String, RawNodeSpec>,
    marks: BTreeMap<String, RawMarkSpec>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawNodeSpec {
    content: Option<String>,
    group: Option<String>,
    #[serde(default)]
    inline: bool,
    marks: Option<String>,
    #[serde(default)]
    code: bool,
    #[serde(default)]
    attrs: BTreeMap<String, RawAttrSpec>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMarkSpec {
    group: Option<String>,
    excludes: Option<String>,
    #[serde(default)]
    attrs: BTreeMap<String, RawAttrSpec>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAttrSpec {
    #[serde(default, deserialize_with = "deserialize_optional_default")]
    default: Option<Value>,
    #[serde(rename = "type")]
    attr_type: String,
}

fn deserialize_optional_default<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy)]
enum AttrType {
    Number,
    Boolean,
    String,
    StringOrNull,
    NonEmptyString,
    Colwidth,
    Align,
    LinkHref,
}

impl AttrType {
    fn parse(s: &str) -> Self {
        match s {
            "number" => Self::Number,
            "boolean" => Self::Boolean,
            "string" => Self::String,
            "string|null" => Self::StringOrNull,
            "non_empty_string" => Self::NonEmptyString,
            "colwidth" => Self::Colwidth,
            "align" => Self::Align,
            "link_href" => Self::LinkHref,
            other => panic!("unknown attribute type in schema.json: {other}"),
        }
    }
}

struct CompiledAttr {
    required: bool,
    attr_type: AttrType,
}

#[derive(Clone)]
enum Expr {
    Empty,
    Name(Vec<String>),
    Seq(Vec<Expr>),
    Choice(Vec<Expr>),
    Star(Box<Expr>),
    Plus(Box<Expr>),
    Opt(Box<Expr>),
    Range {
        expr: Box<Expr>,
        min: usize,
        max: Option<usize>,
    },
}

struct CompiledNode {
    is_text: bool,
    is_inline: bool,
    groups: Vec<String>,
    content: Expr,
    allowed_marks: HashSet<String>,
    attrs: HashMap<String, CompiledAttr>,
}

struct CompiledMark {
    groups: Vec<String>,
    excluded: HashSet<String>,
    attrs: HashMap<String, CompiledAttr>,
}

struct CompiledSchema {
    top_node: String,
    allowed_link_protocols: Vec<String>,
    allowed_alignments: HashSet<String>,
    nodes: HashMap<String, CompiledNode>,
    marks: HashMap<String, CompiledMark>,
}

impl CompiledSchema {
    fn compile(raw: RawSchema) -> Self {
        assert!(
            raw.nodes.contains_key(&raw.top_node),
            "schema missing topNode {}",
            raw.top_node
        );
        assert!(raw.nodes.contains_key("text"), "schema missing text node");

        let mut nodes: HashMap<String, CompiledNode> = raw
            .nodes
            .iter()
            .map(|(name, spec)| {
                assert!(
                    !raw.marks.contains_key(name),
                    "{name} cannot be both a node and a mark"
                );
                let is_text = name == "text";
                let is_inline = spec.inline || is_text;
                let groups = spec
                    .group
                    .as_deref()
                    .map(|g| g.split_whitespace().map(str::to_string).collect())
                    .unwrap_or_default();
                let attrs = compile_attrs(&spec.attrs);
                assert!(
                    !is_text || (!spec.code && attrs.is_empty()),
                    "text node cannot be a code block or have attributes"
                );
                (
                    name.clone(),
                    CompiledNode {
                        is_text,
                        is_inline,
                        groups,
                        content: Expr::Empty,
                        allowed_marks: HashSet::new(),
                        attrs,
                    },
                )
            })
            .collect();

        let marks: HashMap<String, CompiledMark> = raw
            .marks
            .iter()
            .map(|(name, spec)| {
                let groups = spec
                    .group
                    .as_deref()
                    .map(|g| g.split_whitespace().map(str::to_string).collect())
                    .unwrap_or_default();
                (
                    name.clone(),
                    CompiledMark {
                        groups,
                        excluded: HashSet::new(),
                        attrs: compile_attrs(&spec.attrs),
                    },
                )
            })
            .collect();

        let all_mark_names: HashSet<String> = marks.keys().cloned().collect();

        for (name, spec) in &raw.nodes {
            let expr_str = spec.content.as_deref().unwrap_or("");
            let (content, inline_content) = parse_content_expr(expr_str, &nodes);
            let allowed_marks = match spec.marks.as_deref() {
                Some("_") => all_mark_names.clone(),
                Some("") => HashSet::new(),
                Some(list) => gather_marks(list, &marks),
                None if inline_content => all_mark_names.clone(),
                None => HashSet::new(),
            };
            let node = nodes.get_mut(name).unwrap();
            node.content = content;
            node.allowed_marks = allowed_marks;
        }

        let mut compiled_marks = marks;
        let mark_lookup: HashMap<String, Vec<String>> = compiled_marks
            .iter()
            .map(|(k, v)| (k.clone(), v.groups.clone()))
            .collect();
        for (name, spec) in &raw.marks {
            let excluded = match spec.excludes.as_deref() {
                None => HashSet::from([name.clone()]),
                Some("") => HashSet::new(),
                Some("_") => all_mark_names.clone(),
                Some(list) => gather_marks_from_groups(list, &mark_lookup),
            };
            compiled_marks.get_mut(name).unwrap().excluded = excluded;
        }

        Self {
            top_node: raw.top_node,
            allowed_link_protocols: raw.allowed_link_protocols,
            allowed_alignments: raw.allowed_alignments.into_iter().collect(),
            nodes,
            marks: compiled_marks,
        }
    }

    fn is_valid_link_href(&self, href: &str) -> bool {
        if href.is_empty() || href.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return false;
        }
        self.allowed_link_protocols.iter().any(|p| {
            let prefix = if p == "http:" || p == "https:" {
                format!("{p}//")
            } else {
                p.clone()
            };
            href.len() > prefix.len() && href[..prefix.len()].eq_ignore_ascii_case(&prefix)
        })
    }

    fn check_attr_value(&self, attr_type: AttrType, val: &Value) -> bool {
        match attr_type {
            AttrType::Number => val.is_number(),
            AttrType::Boolean => val.is_boolean(),
            AttrType::String => val.is_string(),
            AttrType::StringOrNull => val.is_null() || val.is_string(),
            AttrType::NonEmptyString => val.as_str().is_some_and(|s| !s.is_empty()),
            AttrType::Colwidth => {
                val.is_null()
                    || val
                        .as_array()
                        .is_some_and(|a| a.iter().all(Value::is_number))
            }
            AttrType::Align => {
                val.is_null()
                    || val
                        .as_str()
                        .is_some_and(|s| self.allowed_alignments.contains(s))
            }
            AttrType::LinkHref => val.as_str().is_some_and(|s| self.is_valid_link_href(s)),
        }
    }

    fn validate_attrs(
        &self,
        expected: &HashMap<String, CompiledAttr>,
        given: Option<&Value>,
        kind: &str,
        type_name: &str,
    ) -> Result<(), String> {
        let obj = match given {
            None | Some(Value::Null) => None,
            Some(Value::Object(map)) => Some(map),
            Some(_) => return Err(format!("attrs on {kind} '{type_name}' must be an object")),
        };
        if let Some(map) = obj {
            for key in map.keys() {
                if !expected.contains_key(key) {
                    return Err(format!(
                        "unsupported attribute '{key}' on {kind} '{type_name}'"
                    ));
                }
            }
        }
        for (attr_name, spec) in expected {
            match obj.and_then(|m| m.get(attr_name)) {
                Some(val) => {
                    if !self.check_attr_value(spec.attr_type, val) {
                        return Err(format!(
                            "invalid value for attribute '{attr_name}' on {kind} '{type_name}'"
                        ));
                    }
                }
                None if spec.required => {
                    return Err(format!(
                        "missing required attribute '{attr_name}' on {kind} '{type_name}'"
                    ));
                }
                None => {}
            }
        }
        Ok(())
    }

    fn validate_marks(
        &self,
        given: Option<&Value>,
        allowed_marks: &HashSet<String>,
        node_name: &str,
    ) -> Result<(), String> {
        let Some(val) = given.filter(|v| !v.is_null()) else {
            return Ok(());
        };
        let Some(arr) = val.as_array() else {
            return Err(format!("marks on node '{node_name}' must be an array"));
        };
        let mut seen: Vec<&str> = Vec::with_capacity(arr.len());
        for m in arr {
            let Some(obj) = m.as_object() else {
                return Err("mark must be an object".into());
            };
            for k in obj.keys() {
                if k != "type" && k != "attrs" {
                    return Err(format!("unsupported key '{k}' on mark"));
                }
            }
            let Some(mark_type) = obj.get("type").and_then(Value::as_str) else {
                return Err("mark missing string 'type'".into());
            };
            let Some(mark_spec) = self.marks.get(mark_type) else {
                return Err(format!("unknown mark type '{mark_type}'"));
            };
            if !allowed_marks.contains(mark_type) {
                return Err(format!(
                    "mark '{mark_type}' is not allowed in node '{node_name}'"
                ));
            }
            self.validate_attrs(&mark_spec.attrs, obj.get("attrs"), "mark", mark_type)?;
            for &prev in &seen {
                let prev_spec = &self.marks[prev];
                if prev_spec.excluded.contains(mark_type) || mark_spec.excluded.contains(prev) {
                    return Err(format!(
                        "mark '{mark_type}' conflicts with mark '{prev}' on node '{node_name}'"
                    ));
                }
            }
            seen.push(mark_type);
        }
        Ok(())
    }

    fn validate_node<'a>(
        &self,
        node: &'a Value,
        parent_allowed_marks: &HashSet<String>,
    ) -> Result<&'a str, String> {
        let Some(obj) = node.as_object() else {
            return Err("node must be an object".into());
        };
        let Some(type_name) = obj.get("type").and_then(Value::as_str) else {
            return Err("node missing string 'type'".into());
        };
        let Some(spec) = self.nodes.get(type_name) else {
            return Err(format!("unknown node type '{type_name}'"));
        };

        self.validate_marks(obj.get("marks"), parent_allowed_marks, type_name)?;

        if spec.is_text {
            for k in obj.keys() {
                if k != "type" && k != "text" && k != "marks" {
                    return Err(format!("unsupported key '{k}' on text node"));
                }
            }
            match obj.get("text").and_then(Value::as_str) {
                Some(s) if !s.is_empty() => return Ok(type_name),
                Some(_) => return Err("empty text nodes are not allowed".into()),
                None => return Err("text node missing string 'text'".into()),
            }
        }

        for k in obj.keys() {
            if k != "type" && k != "attrs" && k != "content" && k != "marks" {
                return Err(format!("unsupported key '{k}' on node '{type_name}'"));
            }
        }

        self.validate_attrs(&spec.attrs, obj.get("attrs"), "node", type_name)?;

        let children: &[Value] = match obj.get("content") {
            None | Some(Value::Null) => &[],
            Some(Value::Array(arr)) => arr.as_slice(),
            Some(_) => return Err(format!("content on node '{type_name}' must be an array")),
        };

        let mut child_types = Vec::with_capacity(children.len());
        for child in children {
            let ct = self.validate_node(child, &spec.allowed_marks)?;
            child_types.push(ct);
        }

        if !matches_content(&spec.content, &child_types) {
            return Err(format!("invalid content for node '{type_name}'"));
        }

        Ok(type_name)
    }

    fn validate_doc(&self, doc: &Value) -> Result<(), String> {
        let Some(obj) = doc.as_object() else {
            return Err("document must be a JSON object".into());
        };
        let Some(type_name) = obj.get("type").and_then(Value::as_str) else {
            return Err("document missing 'type'".into());
        };
        if type_name != self.top_node {
            return Err(format!(
                "root node must be '{}', got '{type_name}'",
                self.top_node
            ));
        }
        let no_marks = HashSet::new();
        self.validate_node(doc, &no_marks)?;
        Ok(())
    }
}

fn compile_attrs(raw: &BTreeMap<String, RawAttrSpec>) -> HashMap<String, CompiledAttr> {
    raw.iter()
        .map(|(name, spec)| {
            let compiled = CompiledAttr {
                required: spec.default.is_none(),
                attr_type: AttrType::parse(&spec.attr_type),
            };
            (name.clone(), compiled)
        })
        .collect()
}

fn gather_marks(list: &str, marks: &HashMap<String, CompiledMark>) -> HashSet<String> {
    let lookup: HashMap<String, Vec<String>> = marks
        .iter()
        .map(|(k, v)| (k.clone(), v.groups.clone()))
        .collect();
    gather_marks_from_groups(list, &lookup)
}

fn gather_marks_from_groups(list: &str, marks: &HashMap<String, Vec<String>>) -> HashSet<String> {
    let mut out = HashSet::new();
    for tok in list.split_whitespace() {
        if marks.contains_key(tok) {
            out.insert(tok.to_string());
        } else {
            let mut found = false;
            for (name, groups) in marks {
                if tok == "_" || groups.iter().any(|g| g == tok) {
                    out.insert(name.clone());
                    found = true;
                }
            }
            assert!(found, "unknown mark type or group '{tok}' in schema.json");
        }
    }
    out
}

// ── Content expression parser & matcher ──────────────────────────────────

fn tokenize_expr(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            cur.push(c);
        } else {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            if !c.is_whitespace() {
                tokens.push(c.to_string());
            }
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

struct Parser<'a> {
    tokens: Vec<String>,
    pos: usize,
    nodes: &'a HashMap<String, CompiledNode>,
    inline: Option<bool>,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.pos).map(String::as_str)
    }

    fn eat(&mut self, tok: &str) -> bool {
        if self.peek() == Some(tok) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn parse_expr(&mut self) -> Expr {
        let mut choices = vec![self.parse_seq()];
        while self.eat("|") {
            choices.push(self.parse_seq());
        }
        if choices.len() == 1 {
            choices.pop().unwrap()
        } else {
            Expr::Choice(choices)
        }
    }

    fn parse_seq(&mut self) -> Expr {
        let mut seq = Vec::new();
        while let Some(tok) = self.peek() {
            if tok == ")" || tok == "|" {
                break;
            }
            seq.push(self.parse_subscript());
        }
        match seq.len() {
            0 => Expr::Empty,
            1 => seq.pop().unwrap(),
            _ => Expr::Seq(seq),
        }
    }

    fn parse_subscript(&mut self) -> Expr {
        let mut expr = self.parse_atom();
        loop {
            if self.eat("+") {
                expr = Expr::Plus(Box::new(expr));
            } else if self.eat("*") {
                expr = Expr::Star(Box::new(expr));
            } else if self.eat("?") {
                expr = Expr::Opt(Box::new(expr));
            } else if self.eat("{") {
                let min = self.parse_num();
                let max = if self.eat(",") {
                    if self.peek() == Some("}") {
                        None
                    } else {
                        Some(self.parse_num())
                    }
                } else {
                    Some(min)
                };
                assert!(self.eat("}"), "unclosed '{{' in content expression");
                expr = Expr::Range {
                    expr: Box::new(expr),
                    min,
                    max,
                };
            } else {
                break;
            }
        }
        expr
    }

    fn parse_num(&mut self) -> usize {
        let tok = self.peek().expect("expected number in content expression");
        let n: usize = tok.parse().expect("invalid number in content expression");
        self.pos += 1;
        n
    }

    fn parse_atom(&mut self) -> Expr {
        if self.eat("(") {
            let expr = self.parse_expr();
            assert!(self.eat(")"), "missing ')' in content expression");
            return expr;
        }
        let name = self
            .peek()
            .expect("unexpected end of content expression")
            .to_string();
        self.pos += 1;
        let resolved = self.resolve_name(&name);
        Expr::Name(resolved)
    }

    fn resolve_name(&mut self, name: &str) -> Vec<String> {
        let mut matched: Vec<(&String, &CompiledNode)> =
            if let Some(n) = self.nodes.get_key_value(name) {
                vec![n]
            } else {
                self.nodes
                    .iter()
                    .filter(|(_, n)| n.groups.iter().any(|g| g == name))
                    .collect()
            };
        assert!(
            !matched.is_empty(),
            "unknown node type or group '{name}' in content expression"
        );
        matched.sort_by_key(|(a, _)| *a);
        for (_, node) in &matched {
            if let Some(prev) = self.inline {
                assert_eq!(
                    prev, node.is_inline,
                    "content expression mixes inline and block content"
                );
            } else {
                self.inline = Some(node.is_inline);
            }
        }
        matched.into_iter().map(|(k, _)| k.clone()).collect()
    }
}

fn parse_content_expr(expr_str: &str, nodes: &HashMap<String, CompiledNode>) -> (Expr, bool) {
    let tokens = tokenize_expr(expr_str);
    if tokens.is_empty() {
        return (Expr::Empty, false);
    }
    let mut parser = Parser {
        tokens,
        pos: 0,
        nodes,
        inline: None,
    };
    let expr = parser.parse_expr();
    assert_eq!(
        parser.pos,
        parser.tokens.len(),
        "unexpected trailing token in content expression '{expr_str}'"
    );
    (expr, parser.inline.unwrap_or(false))
}

fn match_positions(expr: &Expr, positions: &BTreeSet<usize>, children: &[&str]) -> BTreeSet<usize> {
    match expr {
        Expr::Empty => positions.clone(),
        Expr::Name(allowed) => positions
            .iter()
            .copied()
            .filter(|&p| p < children.len() && allowed.iter().any(|a| a == children[p]))
            .map(|p| p + 1)
            .collect(),
        Expr::Seq(seq) => {
            let mut cur = positions.clone();
            for e in seq {
                cur = match_positions(e, &cur, children);
                if cur.is_empty() {
                    break;
                }
            }
            cur
        }
        Expr::Choice(choices) => {
            let mut out = BTreeSet::new();
            for c in choices {
                out.extend(match_positions(c, positions, children));
            }
            out
        }
        Expr::Opt(inner) => {
            let mut out = positions.clone();
            out.extend(match_positions(inner, positions, children));
            out
        }
        Expr::Star(inner) => {
            let mut reached = positions.clone();
            let mut frontier = positions.clone();
            while !frontier.is_empty() {
                let next: BTreeSet<usize> = match_positions(inner, &frontier, children)
                    .into_iter()
                    .filter(|p| reached.insert(*p))
                    .collect();
                frontier = next;
            }
            reached
        }
        Expr::Plus(inner) => {
            let first = match_positions(inner, positions, children);
            match_positions(&Expr::Star(inner.clone()), &first, children)
        }
        Expr::Range {
            expr: inner,
            min,
            max,
        } => {
            let mut cur = positions.clone();
            for _ in 0..*min {
                cur = match_positions(inner, &cur, children);
            }
            match max {
                None => match_positions(&Expr::Star(inner.clone()), &cur, children),
                Some(m) => {
                    let mut reached = cur.clone();
                    for _ in *min..*m {
                        cur = match_positions(inner, &cur, children);
                        reached.extend(&cur);
                    }
                    reached
                }
            }
        }
    }
}

fn matches_content(expr: &Expr, children: &[&str]) -> bool {
    let start = BTreeSet::from([0]);
    match_positions(expr, &start, children).contains(&children.len())
}

fn compiled_schema() -> &'static CompiledSchema {
    static SCHEMA: OnceLock<CompiledSchema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let raw: RawSchema =
            serde_json::from_str(SCHEMA_JSON).expect("frontend/src/schema.json must be valid");
        CompiledSchema::compile(raw)
    })
}

/// Validates a card description against the shared ProseMirror schema.
/// An empty string `""` is valid (represents an empty description); otherwise
/// `description` must be a JSON-serialized ProseMirror `doc` node conforming
/// to `frontend/src/schema.json`.
pub fn validate_description(description: &str) -> Result<(), AppError> {
    if description.is_empty() {
        return Ok(());
    }
    let val: Value = serde_json::from_str(description).map_err(|_| {
        AppError::BadRequest("description must be empty or valid ProseMirror JSON".into())
    })?;
    compiled_schema()
        .validate_doc(&val)
        .map_err(|msg| AppError::BadRequest(format!("invalid description schema: {msg}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ok(doc: Value) {
        let s = doc.to_string();
        assert!(
            validate_description(&s).is_ok(),
            "expected valid: {s}, got: {:?}",
            validate_description(&s)
        );
    }

    fn err(doc: Value) {
        let s = doc.to_string();
        assert!(validate_description(&s).is_err(), "expected invalid: {s}");
    }

    #[test]
    fn accepts_empty_and_all_valid_schema_constructs() {
        assert!(validate_description("").is_ok());

        ok(json!({
            "type": "doc",
            "content": [
                { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Title" }] },
                {
                    "type": "paragraph",
                    "content": [
                        { "type": "text", "text": "Hello " },
                        { "type": "text", "marks": [{ "type": "strong" }, { "type": "em" }], "text": "world" },
                        { "type": "hard_break" },
                        { "type": "text", "marks": [{ "type": "code" }], "text": "x" },
                        {
                            "type": "text",
                            "marks": [{ "type": "link", "attrs": { "href": "https://example.com/a?b=c", "title": "Ex" } }],
                            "text": "link"
                        },
                        {
                            "type": "text",
                            "marks": [{ "type": "link", "attrs": { "href": "mailto:a@example.com" } }],
                            "text": "mail"
                        },
                        { "type": "image", "attrs": { "att": "att-1", "alt": "shot.png" } }
                    ]
                },
                {
                    "type": "blockquote",
                    "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "quoted" }] }]
                },
                {
                    "type": "code_block",
                    "content": [{ "type": "text", "text": "fn main() {}" }]
                },
                {
                    "type": "lua_block",
                    "content": [{ "type": "text", "text": "return 1 + 2" }]
                },
                {
                    "type": "lua_block",
                    "attrs": { "output": "=> 3", "error": null, "ran_hash": "deadbeef" },
                    "content": [{ "type": "text", "text": "return 1 + 2" }]
                },
                {
                    "type": "bullet_list",
                    "content": [{
                        "type": "list_item",
                        "content": [
                            { "type": "paragraph", "content": [{ "type": "text", "text": "item" }] },
                            {
                                "type": "ordered_list",
                                "attrs": { "order": 1 },
                                "content": [{
                                    "type": "list_item",
                                    "content": [{ "type": "paragraph" }]
                                }]
                            }
                        ]
                    }]
                },
                {
                    "type": "table",
                    "attrs": { "matrix": true },
                    "content": [
                        {
                            "type": "table_row",
                            "content": [
                                { "type": "table_cell", "content": [{ "type": "paragraph" }] },
                                { "type": "table_header", "attrs": { "align": "center", "colspan": 1, "rowspan": 1, "colwidth": [120] }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "H" }] }] }
                            ]
                        },
                        {
                            "type": "table_row",
                            "content": [
                                { "type": "table_header", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "R" }] }] },
                                { "type": "table_cell", "attrs": { "align": "right" }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "1" }] }] }
                            ]
                        }
                    ]
                }
            ]
        }));
    }

    #[test]
    fn rejects_non_json_and_wrong_root() {
        for raw in ["plain text", "{}", "[]", "null", "42", "\"str\""] {
            assert!(validate_description(raw).is_err(), "{raw}");
        }
        err(json!({ "type": "paragraph" }));
        err(json!({ "type": "doc" }));
        err(json!({ "type": "doc", "content": [] }));
        err(json!({
            "type": "doc",
            "marks": [{ "type": "strong" }],
            "content": [{ "type": "paragraph" }]
        }));
    }

    #[test]
    fn rejects_disallowed_nodes_and_invalid_nesting() {
        // horizontal_rule is excluded from the schema (ADR-0015).
        err(json!({ "type": "doc", "content": [{ "type": "horizontal_rule" }] }));
        err(json!({ "type": "doc", "content": [{ "type": "unknown_node" }] }));
        // Inline node directly under doc.
        err(json!({ "type": "doc", "content": [{ "type": "text", "text": "a" }] }));
        // Block node inside paragraph.
        err(json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "paragraph" }] }]
        }));
        // list_item must start with a paragraph (`paragraph block*`).
        err(json!({
            "type": "doc",
            "content": [{
                "type": "bullet_list",
                "content": [{
                    "type": "list_item",
                    "content": [{ "type": "bullet_list", "content": [{ "type": "list_item", "content": [{ "type": "paragraph" }] }] }]
                }]
            }]
        }));
        // Table cell only allows `paragraph+`, not lists or headings.
        err(json!({
            "type": "doc",
            "content": [{
                "type": "table",
                "content": [{
                    "type": "table_row",
                    "content": [{
                        "type": "table_cell",
                        "content": [{ "type": "heading", "content": [{ "type": "text", "text": "no" }] }]
                    }]
                }]
            }]
        }));
        // Leaf nodes cannot have content.
        err(json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "hard_break", "content": [{ "type": "text", "text": "x" }] }]
            }]
        }));
        // Empty text node.
        err(json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "" }] }]
        }));
    }

    #[test]
    fn rejects_invalid_attributes_and_unknown_keys() {
        // Unknown key on node.
        err(json!({ "type": "doc", "extra": 1, "content": [{ "type": "paragraph" }] }));
        // Unknown attribute on paragraph.
        err(json!({ "type": "doc", "content": [{ "type": "paragraph", "attrs": { "foo": 1 } }] }));
        // Wrong attribute type on heading.
        err(
            json!({ "type": "doc", "content": [{ "type": "heading", "attrs": { "level": "two" } }] }),
        );
        // Image missing required `att` or with empty `att` or with `src` URL.
        err(
            json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "image", "attrs": {} }] }] }),
        );
        err(
            json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "image", "attrs": { "att": "" } }] }] }),
        );
        err(
            json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "image", "attrs": { "src": "https://evil/x.png" } }] }] }),
        );
        // Invalid table cell align or colwidth.
        err(json!({
            "type": "doc",
            "content": [{
                "type": "table",
                "content": [{
                    "type": "table_row",
                    "content": [{ "type": "table_cell", "attrs": { "align": "justify" }, "content": [{ "type": "paragraph" }] }]
                }]
            }]
        }));
        err(json!({
            "type": "doc",
            "content": [{
                "type": "table",
                "content": [{
                    "type": "table_row",
                    "content": [{ "type": "table_cell", "attrs": { "colwidth": ["bad"] }, "content": [{ "type": "paragraph" }] }]
                }]
            }]
        }));
    }

    #[test]
    fn rejects_invalid_marks_and_unsafe_links() {
        // Marks are forbidden inside code_block and lua_block (`marks: ""`).
        err(json!({
            "type": "doc",
            "content": [{
                "type": "code_block",
                "content": [{ "type": "text", "marks": [{ "type": "strong" }], "text": "x" }]
            }]
        }));
        err(json!({
            "type": "doc",
            "content": [{
                "type": "lua_block",
                "content": [{ "type": "text", "marks": [{ "type": "strong" }], "text": "x" }]
            }]
        }));
        err(json!({
            "type": "doc",
            "content": [{
                "type": "lua_block",
                "attrs": { "extra": 1 },
                "content": [{ "type": "text", "text": "return 1" }]
            }]
        }));
        // Marks are forbidden on block nodes.
        err(json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "marks": [{ "type": "strong" }] }]
        }));
        // Duplicate marks of the same type on one text node.
        err(json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "marks": [{ "type": "strong" }, { "type": "strong" }], "text": "x" }]
            }]
        }));
        // Disallowed link hrefs (ADR-0015).
        for bad_href in [
            "",
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            " data:text/html,<script>",
            "file:///etc/passwd",
            "/relative/path",
            "www.example.com",
            "https://",
            "mailto:",
            "https://example.com/with space",
        ] {
            err(json!({
                "type": "doc",
                "content": [{
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "marks": [{ "type": "link", "attrs": { "href": bad_href } }],
                        "text": "click"
                    }]
                }]
            }));
        }
    }
}
