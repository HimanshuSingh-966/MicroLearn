# UI/UX Design Brief — MicroLearn
*(Paste this into Google AI Studio, Claude, ChatGPT, etc. to compare design outputs on equal footing.)*

## What to design
A browser-based web app screen for **MicroLearn** — a live microscope viewer where a student clicks on a part of a cell image to see information about it. Design the **main viewing screen**, the primary interface a student sees during use.

## Context (use this to inform the design, don't just decorate around it)
- User: a school/college biology student, standing at a microscope station, looking between the physical microscope and this screen.
- The screen shows a **live video feed** while the operator positions and focuses the stained onion slide. The approved flow is: **Capture & Analyze** → show the exact captured still during analysis and selection → return to Live to position and capture another view. Analysis and overlays must refer to that same identifiable frame. Still-image capture for analysis is a planned feature, not yet implemented.
- The student **clicks an analyzed image** to select one internal structure or the complete visible wall border around one cell. Use predicted structure labels and cell identities; a wall selection highlights the border while leaving the interior unfilled.
- For a shared wall, show candidate adjacent cell boundaries and ask for a second click inside the intended cell. A junction may have more than two candidates. This disambiguation click chooses the cell for the pending wall selection; it does not switch to selecting the clicked internal structure.
- For cells clipped by the image edge or with unresolved boundary evidence, show only the supported visible border and explicitly indicate that the boundary is incomplete. Do not draw a fictional closing edge.
- On click, an **info panel** appears showing: structure name, a short description, and its function — assume this is a small amount of text (2–4 sentences), not a long article.
- A right-side chat panel lets an adult user (18+) ask follow-up questions about the selected structure. Send only the selected class/region, reviewed description, user question, and chat history to Gemini through OCI; do not send the image. This chat must not be available to users under 18.
- If Gemini is unavailable, keep the reviewed info card visible, show that chat is unavailable, and provide a Retry action. The chat supplements reviewed content; it does not replace it.
- Any sample selector lists actual onion samples/captures. Changing images clears stale predictions and selections; other specimen types are outside the approved model scope.
- This runs on a **laptop or tablet screen** in a classroom/demo setting, viewed from normal sitting distance — not a phone screen, not a large public display.

## Required elements (the design must include all of these)
1. Live video feed area displaying the actual camera signal; unavailable input has an explicit no-signal state
2. A **Capture & Analyze** action in Live mode and a **Return to Live** action while viewing the captured/analyzed still
3. Click/selection affordance and a highlight derived from the actual structure and cell-ID masks for the analyzed frame
4. Info panel showing structure name + description + function
5. Sample selector or active sample identification using actual records
6. A clear visual state for "no signal" (camera disconnected) — design this state too, not just the happy path
7. Distinct states for capturing, processing, analysis unavailable, no reliable identification, and missing reviewed information
8. Clear indication of the captured frame being analyzed; do not overlay its masks on live footage
9. Shared-wall candidate selection, cancellation, and a second interior click to confirm the intended cell
10. An incomplete-boundary indication for a clipped cell or unresolved border
11. A contextual chat panel for users aged 18 or older, with clear unavailable/retry state and no image upload to Gemini

## Tone and constraints
- Audience is students, not clinicians — avoid a cold, clinical/medical-device aesthetic. This is an educational tool, not diagnostic software.
- Avoid generic "AI product" visual clichés — no default purple/blue gradients, no generic neural-network or circuit-board motifs, no glowing sci-fi effects. This is a real, physical, hands-on classroom tool — the design should feel tactile and grounded, not abstractly futuristic.
- Should work convincingly as a **live product demo in front of judges** — legible from a short distance, not overly dense or small-text-heavy.
- No login/account screens, no onboarding flow — this brief is for the single main screen only.
- Use actual predictions, measured status, and reviewed information. Do not supply temporary fake segmentation, confidence scores, or biological content to make the interface appear complete.

## What NOT to include
- Don't design a marketing landing page — this is the actual in-use application screen.
- Don't invent extra features not listed above (no social sharing, no gamification/points system). The selected contextual chat panel is part of the approved screen scope and is limited to adult users.
- Don't use real, identifiable stock photos of people.

## Deliverable format requested
Please provide:
1. A single main-screen design (image, mockup, or detailed code/markup — whatever your tool produces natively).
2. A short written rationale (3–5 sentences) explaining your layout and color choices, so the choices can be compared across tools, not just the visuals.

---
*Internal note (not part of the prompt to paste): once you have outputs from all three tools, compare them against the "Required elements" and "What NOT to include" lists above as an objective checklist, not just aesthetic preference — that'll make the comparison fairer across tools with very different visual styles.*
