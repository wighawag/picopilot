---
"picopilot": patch
---

Make the agent JUDGE the rendered frame, not just confirm it drew, so readability and layout-fairness defects get caught. A large-model run verified every state transition thoroughly but shipped a game where a hazard was the same colour as the background and obstacle gaps were too tight to pass, because it only ever confirmed screenshots "rendered" and never critiqued them.

The scaffolded `AGENTS.md` definition of done now adds a "judge the frame" check: when you look at a gameplay screenshot, actively hunt for what is WRONG (can you tell every entity apart from the background and each other; are hazards spaced so a human can react in ~250ms rather than frame-perfect; does it look intentional), because "it renders" is not "it is good". `game-design-reference` gains the matching self-check that applies its readability + fairness lenses to the actual rendered image, not just the logic. Kept concrete (distinguishable? clearable? intentional?) rather than a vague "make it pretty".
