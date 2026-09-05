//! Deterministic Markdown safety net for Ask AI answers.
//!
//! Despite the Ask AI system prompt (`prompts::ask::SYSTEM_PROMPT`)
//! explicitly mandating Markdown formatting, live testing across
//! gpt-4o-mini, gpt-4o, and gpt-5-mini surfaced two variants of the same
//! failure mode: the model organizes a multi-step answer correctly (one
//! distinct stage per line, e.g. "Data Ingestion: first you gather..." or
//! "**Data Ingestion:** first you gather..."), but omits the actual
//! `1. `/`2. ` numbering needed to render it as a real Markdown list instead
//! of a flat run of paragraphs — sometimes it also skips the `**bold**`
//! syntax on top of that, sometimes it doesn't. Rather than keep gambling on
//! prompt wording or model choice, this detects both shapes and rewrites
//! them — cheap, synchronous text processing, not another LLM call, so it
//! adds no meaningful latency.

use regex::Regex;

/// Rewrites a run of "Label: sentence" lines into a real Markdown numbered
/// list with the label bolded (`1. **Label:** sentence`), or a run of
/// already-bolded-but-unnumbered "**Label:** sentence" lines into the same
/// shape with numbering added. Deliberately narrow: requires at least two
/// matching lines before touching anything, so a single incidental
/// "Result: it worked" inside otherwise normal prose is left alone — this
/// must never reshape an answer that's already fine.
pub fn ensure_markdown_structure(answer: &str) -> String {
    let plain_label_re = Regex::new(r"^([A-Z][A-Za-z0-9 /&'-]{1,40}):\s+(.+)$").expect("static regex is valid");
    let bold_label_re = Regex::new(r"^\*\*([A-Za-z0-9 /&'-]{1,40}):\*\*\s+(.+)$").expect("static regex is valid");

    let lines: Vec<&str> = answer.lines().collect();

    let plain_match_count = lines.iter().filter(|line| plain_label_re.is_match(line)).count();
    if plain_match_count >= 2 {
        return number_matching_lines(&lines, |line| {
            plain_label_re.captures(line).map(|caps| (caps[1].to_string(), caps[2].to_string()))
        });
    }

    let bold_match_count = lines.iter().filter(|line| bold_label_re.is_match(line)).count();
    if bold_match_count >= 2 {
        return number_matching_lines(&lines, |line| {
            bold_label_re.captures(line).map(|caps| (caps[1].to_string(), caps[2].to_string()))
        });
    }

    answer.to_string()
}

/// Shared rewrite step for both label shapes above: walks the answer's
/// lines, and for every one `extract` recognizes as a (label, rest) pair,
/// emits it as a numbered, bolded list item; every other line passes
/// through unchanged.
fn number_matching_lines(lines: &[&str], extract: impl Fn(&str) -> Option<(String, String)>) -> String {
    let mut out = String::new();
    let mut step = 0u32;
    for line in lines {
        if let Some((label, rest)) = extract(line) {
            step += 1;
            out.push_str(&format!("{step}. **{label}:** {rest}\n"));
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
    fn leaves_already_numbered_bold_lines_untouched() {
        let input = "1. **Data Ingestion:** gather the documents.\n2. **Chunking:** split them up.";
        assert_eq!(ensure_markdown_structure(input), input);
    }

    #[test]
    fn adds_numbering_to_bolded_but_unnumbered_label_lines() {
        // The real failure mode reported live: gpt-4o bolds each label but
        // never adds the "1. " list marker, so react-markdown renders it as
        // indented bold paragraphs instead of an actual numbered list.
        let input = "RAG is a system architecture that combines retrieval with generation.\n\n**Data Ingestion:** The process starts with collecting documents.\n**Chunking:** The documents are divided into manageable chunks.\n**Retrieval:** Relevant chunks are retrieved via similarity search.\n\nThis grounds the response in real data.";
        let out = ensure_markdown_structure(input);
        assert!(out.contains("1. **Data Ingestion:** The process starts with collecting documents."));
        assert!(out.contains("2. **Chunking:** The documents are divided into manageable chunks."));
        assert!(out.contains("3. **Retrieval:** Relevant chunks are retrieved via similarity search."));
        assert!(out.starts_with("RAG is a system architecture"));
        assert!(out.ends_with("This grounds the response in real data."));
    }

    #[test]
    fn leaves_a_single_incidental_bolded_label_line_untouched() {
        let input = "I built a small tool for this.\n\n**Result:** it worked well for the team.";
        assert_eq!(ensure_markdown_structure(input), input);
    }
}
