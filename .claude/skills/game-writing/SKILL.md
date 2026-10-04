---
name: game-writing
description: Use for ANY player-facing text in The Show — inbox mail, news/Feed posts, pundit and beat-writer pieces, scenes and phone calls, pressers, staff/scout reports, board messages, Wrapped, camp verdicts, commentary lines, tooltips, empty states, button labels, template/variant pools. Covers voice, banned AI tells, truthfulness to sim facts, template engineering (slots, conditions, variant depth), and the measurement gates. Load it before writing or rewriting game prose.
---

# Writing for The Show

Every sentence the game shows is read by someone who loves hockey and has read thousands of real game stories, mailbag columns and broadcast calls. They can tell instantly when text was written by a machine that doesn't watch hockey. One generic or false line breaks the whole fiction, so this guide exists to make the game's writing sound like the hockey world: specific, factual, short and in character.

## 1. The three laws

1. **True to the sim.** Every claim must be derivable from game state you were actually given: the score, the stat line, the standings, the contract, the injury, the relationship history. Never invent a cause, a quote, a feeling or a number. If the facts don't support a sentence, cut the sentence.
   *Why:* false text is worse than no text. The owner has flagged "doesn't make sense" lines as the top problem.
2. **Specific beats general.** Names, numbers, dates, places, opponents and stakes. Replace any sentence that could appear in any game about any team.
   - Bad: "He has been playing well lately."
   - Good: "Five goals in his last four, two of them on the power play."
3. **In a hockey voice, not an AI voice.** Short sentences. Concrete verbs. Hockey vocabulary used correctly. No throat-clearing, no hedging, no moralising.

## 2. Banned: the AI tells

These patterns mark text as machine-written. Never write them, and fix them wherever you find them.

**Words and phrases:**
- delve, testament, tapestry, landscape, realm, journey (for a season), navigate (a situation), underscore, highlight (as a verb), showcase, foster, bolster, garner, pivotal, crucial, robust, meticulous, intricate, vibrant, enduring, invaluable, seamless;
- "it's worth noting", "in today's…", "at the end of the day", "only time will tell", "remains to be seen", "a reminder that", "speaks volumes", "sends a message";
- "game-changer", "a true X", "elevate".

**Structures:**
- **Negative parallelism:** "It's not just X, it's Y." / "This isn't about X. It's about Y."
- **Reflexive rule of three:** "fast, skilled, and relentless". Use a list of three only when there really are three things.
- **Tailing participle clauses that add fake significance:** "…, underscoring his importance to the team." / "…, highlighting the club's depth."
- **Vague attribution:** "many believe", "experts say", "some have suggested". In this game, attribute to a named character or don't attribute.
- **Hedging stacks:** "may potentially", "could perhaps", "somewhat arguably".
- **Summary or moral endings:** "Ultimately, it was a night to remember." / "In the end, hard work paid off."
- **Emotional narration of the obvious:** "Fans were thrilled as…" Show the event and let the reader feel it.
- **Em-dash chains and colon reveals in every sentence.** One per piece at most.

**Formatting:** no bold-every-line, no bullet-point prose in narrative text, no headings inside a 3-sentence mail.

## 3. Voices

Each speaker has a voice. Pick the speaker first, then write as them.

| Speaker | Sounds like | Example |
|---|---|---|
| Beat writer (news) | Lede with the fact, then context, then one telling detail. Past tense, third person. | "The Penguins sent Sam Poulin to Wilkes-Barre on Tuesday, the third time this season he's been sent down after a single game." |
| Pundit / columnist | An opinion with a reason. Names names. Allowed to be wrong, never vague. | "Trading a first for a 34-year-old rental is how Calgary ended up here last time." |
| Radio play-by-play | Present tense, short bursts, names at the pauses, the action not the meaning. | "Crosby, across to Rust… one-timer, SCORES!" |
| GM / coach in a meeting | Plain, practical, a little guarded. Talks about ice time, matchups, the cap. | "He's not playing his way out of the top six. I want him on the half-wall on the second unit." |
| Player in a scene | Short, a bit defensive or blunt, hockey clichés used like a real player uses them. | "I just want to play. Put me with guys who can skate." |
| Agent | Transactional and polite, numbers early. | "We're looking at four years at six-and-a-half. He's not taking less to stay." |
| AGM / scout report | Clipped and evaluative, with grades and comparables. | "Skates well, shoots it hard, defends like he's waiting for the bus. Third-line ceiling." |
| PA / scorebug / UI | Terse labels. No sentences where a label works. | "Power play · 1:32" |

**Hockey vocabulary**, used correctly: top six, bottom pair, the half-wall, the point, net front, the slot, a one-timer, a dump-and-chase, a breakout, the forecheck, a cap hit (not "salary" in cap talk), waivers, an ELC, an RFA/UFA, a QO, ice time, TOI, a plus-minus, a healthy scratch, sent down / called up, a rental, at the deadline. Wrong usage is worse than none.

## 4. Template and variant engineering

Most game text is templates with slots, picked from variant pools (`src/engine/story/contentEngine.ts`, `prose.ts`). The rules below are hard-won; see the memory notes `project_prose-craft-rules` and `project_content-pool-craft`.

- **Every slot must be filled from facts.** An unfilled `{slot}`, an "undefined", a "1 games" or a "his" for a club is a ship-blocker. Use the helpers in `prose.ts`: `possessive`, `oneSentence`, `prosaicList`, and plural helpers.
- **The template must be true for every state that can select it.** If a variant says "his third straight", the condition must guarantee exactly three. Write conditions as tight as the claim.
- **Write a variant pool, not a sentence.** For any line that fires often, write 5–12 variants. **Siblings go at EQUAL specificity**: most-specific-wins means a single more-specific variant becomes the only line for that whole population (the dominance trap). Add a conditioned variant, add three.
- **Vary structure, not just synonyms.** Five variants that all open "X has been…" read as one. Vary sentence shape, lede and length.
- **Repetition control.** One-time beats use the content ledger. View text that rebuilds every render uses `pickStable` / `renderStable` keyed by a stable id. Lists shown together share one ledger, so adjacent cards differ.
- **Tag at the write site.** Curation tags (`NewsItem.reach`) go on the item, never matched by regex on the prose.
- **Numbers:** money as "$6.5 million" in prose and "$6.5M" in tables; games and stat lines as a fan would read them ("2G 1A", "a .921 save percentage"); ranks as "third in the Metro".

## 5. Commentary lines (spoken)

Commentary is spoken by one radio play-by-play voice (see the `docs/COMMENTARY-BOOTH.md` rules).
- **Short.** Most lines are 2–8 words.
- **Names at natural pauses:** "{name}! He shoots, and scores!" Never mid-clause.
- **Call what happened, never the result before it happens.** A shot line must match its outcome.
- **No line repeats within a game.**
- **Vary by situation:** score state, period, power play, rivalry, milestone.

## 6. Process (follow it every time)

1. **Read the generator and its facts first.** Know exactly what state can reach this text.
2. **Pick the speaker and their voice** (§3).
3. **Write the pool** (§4), then cut every sentence that fails law 1, 2 or 3.
4. **Self-review against the checklist below.** Read each line aloud; if a hockey fan wouldn't say it or print it, rewrite it.
5. **Measure, never assert:**
   - the prose-audit harness: `PA_RUN=1 PA_SEASONS=2 PA_TAG=<x> npx vitest run src/engine/story/proseAudit.harness.test.ts --no-file-parallelism`. It reports repeats, volume and banned phrases. Add any new pool to its coverage.
   - The pool's tests must assert: no unfilled slots, sibling depth for common conditions, and conditions that make each claim true.
6. **Show before/after examples in your report,** with real generated output, not hand-picked templates.

## 7. Checklist

- [ ] Every claim is derivable from the facts passed in.
- [ ] No banned word or structure (§2). Grep for them.
- [ ] Specific: a name, number or stake in every sentence that can carry one.
- [ ] The speaker's voice is consistent (§3).
- [ ] Hockey terms used correctly.
- [ ] Pools are deep enough, with equal-specificity siblings.
- [ ] No unfilled slots, no plural, possessive or a/an bugs.
- [ ] The prose-audit repeat count did not rise; any new pool is covered.
- [ ] A hockey fan would believe a human wrote it.

## 8. Before → after

- Bad: "Sidney Crosby continues to showcase his enduring brilliance, underscoring his pivotal role in the team's success."
  Good: "Crosby had three points against Buffalo. He's at 41 through 38 games, his best pace since 2019."
- Bad: "The trade sends a message: management is serious about winning now."
  Good: "Dubas gave up a first and Poulin for eight weeks of a 34-year-old. That's a bet on this spring."
- Bad: "It's not just about talent — it's about heart, grit, and determination."
  Good: "He blocked three shots on the penalty kill in the third."
- Bad (scene): "I feel that my contributions to the team have not been adequately recognized."
  Good: "Twelve minutes a night? I was on your top line in October."
- Bad (commentary): "What an incredible display of skill as he finds the back of the net!"
  Good: "Malkin… top shelf!"

## Sources

- Anthropic, "Prompting best practices", Claude Platform Docs (explain why a rule matters; be explicit about the output wanted): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Wikipedia, "Signs of AI writing" (the vocabulary and structure tells catalogued in §2): https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- This project's own lessons: `docs/WRITING-PASS-2026-08-26.md` and the memory notes `project_prose-craft-rules` and `project_content-pool-craft`.
