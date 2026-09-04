//! Deterministic Markdown safety net for Ask AI answers.
//!
//! Despite the Ask AI system prompt (`prompts::ask::SYSTEM_PROMPT`)
//! explicitly mandating Markdown formatting, live testing across
//! gpt-4o-mini, gpt-4o, and gpt-5-mini all showed the same failure mode: the
//! model organizes a multi-step answer correctly (one distinct stage per
//! line, e.g. "Data Ingestion: first you gather..."), but omits the actual
//! `**bold**`/`1. ` syntax needed to render it as anything but a flat
//! paragraph. Rather than keep gambling on prompt wording or model choice,
//! this detects that exact shape and rewrites it — cheap, synchronous text
//! processing, not another LLM call, so it adds no meaningful latency.

use regex::Regex;

/// Rewrites a run of "Label: sentence" lines into a real Markdown numbered
/// list with the label bolded (`1. **Label:** sentence`). Deliberately
/// narrow: requires at least two matching lines before touching anything,
/// so a single incidental "Result: it worked" inside otherwise normal prose
/// is left alone — this must never reshape an answer that's already fine.
pub fn ensure_markdown_structure(answer: &str) -> String {
    let label_re = Regex::new(r"^([A-Z][A-Za-z0-9 /&'-]{1,40}):\s+(.+)$").expect("static regex is valid");

    let lines: Vec<&str> = answer.lines().collect();
    let match_count = lines.iter().filter(|line| label_re.is_match(line)).count();
    if match_count < 2 {
        return answer.to_string();
    }

    let mut out = String::with_capacity(answer.len() + 64);
    let mut step = 0u32;
    for line in &lines {
        if let Some(caps) = label_re.captures(line) {
            step += 1;
            out.push_str(&format!("{step}. **{}:** {}\n", &caps[1], &caps[2]));
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_two_or_more_label_lines_into_a_numbered_list() {
        let input = "Sure, let's walk through it.\n\nData Ingestion: gather the documents.\nDocument Chunking: split them into pieces.\nEmbedding Generation: convert chunks into vectors.\n\nThis grounds the response in real data.";
        let out = ensure_markdown_structure(input);
        assert!(out.contains("1. **Data Ingestion:** gather the documents."));
        assert!(out.contains("2. **Document Chunking:** split them into pieces."));
        assert!(out.contains("3. **Embedding Generation:** convert chunks into vectors."));
        assert!(out.starts_with("Sure, let's walk through it."));
        assert!(out.ends_with("This grounds the response in real data."));
    }

    #[test]
    fn leaves_a_single_incidental_label_line_untouched() {
        let input = "I built a small tool for this.\n\nResult: it worked well for the team.";
        assert_eq!(ensure_markdown_structure(input), input);
    }

    #[test]
    fn leaves_plain_prose_with_no_label_lines_untouched() {
        let input = "RAG retrieves relevant info from a knowledge base before generating a response.";
        assert_eq!(ensure_markdown_structure(input), input);
    }

    #[test]
    fn leaves_already_bolded_lines_untouched_since_they_dont_match_the_bare_label_shape() {
        let input = "1. **Data Ingestion:** gather the documents.\n2. **Chunking:** split them up.";
        assert_eq!(ensure_markdown_structure(input), input);
    }
}
