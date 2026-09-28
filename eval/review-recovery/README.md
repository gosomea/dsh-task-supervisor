# Review recovery and observation audits

Run `python3 summary.py <main Session jsonl> <new output JSON> [--labels <labels JSON>]`. Existing output files are never overwritten. This audit does not replace external task grading or alter the frozen NodeBB/Navidrome results.

`progressReviewMode` is `current` (default), `configured`, or `required-only`. The first two use the actual configured activity and round thresholds. The current defaults remain 24 tool results, 300000 ms, three consecutive errors and three rounds. `required-only` disables extra progress observations while retaining plan, stage and completion reviews. Every job records its effective settings; a policy name alone is insufficient evidence.

A sparse configured condition may fix 48 results, 600000 ms, three errors and six rounds. This is an experimental condition, not an established improvement. Freeze tasks, runtime, model, approval, repair and time limits before comparing all conditions in clean workspaces. Development regressions stay separate from unseen evaluation tasks.

Metrics use unique review jobs as their denominator, including missing protocol recovered by repair. Manual waiting is excluded from recorded runtime review windows; absent old timing remains unknown. Labels keyed by job ID can state `drift` and `correctionEffective`. Without labels, false pauses and correction quality remain null. Missed drift needs separate annotation of unreviewed intervals. External reward, timely completion and all Session tokens require independent grading and native usage records.

Independent Python fixtures cover repair success, manual provider recovery, empty samples and legacy timing. They run through the focused Vitest gate. Integrated evidence lives in [the A–F execution record](../../docs/10-plans/conversation-and-review-recovery/evidence/).

See the [frozen follow-up comparison](frequency-p2-protocol.md): four candidate tasks, five conditions and three repeats. The 60 planned attempts have not run; the current NodeBB run is development regression only.
