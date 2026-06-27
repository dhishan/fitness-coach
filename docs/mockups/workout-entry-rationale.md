# Workout Entry UX - Pain Points and Design Rationale

## Concrete Pain Points (with file:line references)

### 1. Tiny stepper buttons (workout.tsx:1373-1381)
`stepBtn` is 24x28 pt. Apple HIG minimum recommended tap target is 44x44. At the gym
with one hand or wet fingers, missing a 24pt button is common. Three buttons per field
(minus, input, plus) packed into a ~100pt span means mis-tapping a neighboring target
is the norm, not the exception.

### 2. Cramped set row fitting too much in one line (workout.tsx:1317-1323, 1371-1411)
A single set row at paddingVertical:6 / gap:4 tries to fit all of these horizontally
on a ~375pt screen:
- Warmup col (42pt wide, includes a 65%-scaled Switch + 9pt label)
- Weight stepper: minus(24) + input(38) + plus(24) + unit label(~15) = ~105pt
- Reps stepper: same, ~105pt
- RPE input: 36pt
- Remove button: 32pt
Total: ~320pt + 5 gaps at 4pt = ~340pt, leaving almost no breathing room on a 390pt
device. Any safe-area or card padding makes it overflow or force items to compress
further.

### 3. RPE as a free-text decimal input (workout.tsx:193-201, 1393-1403)
`rpeInput` is 36pt wide at fontSize:10 - the smallest element in the row. RPE in
practice takes values 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10. A free decimal text field
is worse than a chip picker or slider: the user has to focus a tiny input, type a
number, dismiss the keyboard, and repeat per set. It also allows arbitrary values like
"3.7" which are meaningless.

### 4. Warmup toggle is a 65%-scaled Switch (workout.tsx:1324)
`warmupSwitch` applies `transform: [scaleX(0.65), scaleY(0.65)]`. A native Switch
already has a small tap area; scaling it down to 65% makes it very hard to hit reliably.
The "Warmup" label below it is 9pt text (workout.tsx:1326).

### 5. "Add set" button has no visual prominence (workout.tsx:1313-1314)
`addSetBtn` has marginTop:8 with no height, no border, no background - just 12pt primary
colored text. At the gym between sets, you want a clear "done, log next set" action
that is hard to miss-tap. A text link that size does not qualify.

### 6. No active-set concept or sequential logging
The current model shows all sets simultaneously in a scrollable list. After completing
a set, the user has to find the right row, enter weight + reps + RPE separately in
three tiny inputs or six stepper taps. There is no concept of "log this set now" that
locks focus on the current set.

### 7. No "repeat last set" shortcut
`addSet` (workout.tsx:258-261) copies the last set's weight/reps when adding - that is
good - but the button is not labeled to communicate this. The action is presented as
generic "+ Add set", so users do not realize they can rely on it as a "copy-down" and
end up manually retyping values.

### 8. Keyboard coverage risk for lower sets
While `automaticallyAdjustKeyboardInsets` is set (workout.tsx:981), tapping an input
in a set row that is near the bottom of a long exercise card (4+ sets) may put the
keyboard on top of it. The offset depends on how much content is above the row inside
the ScrollView.

---

## Design Directions

### Direction A - "Fat Steppers" (minimal layout change, maximal tap target fix)
The same row-per-set structure, but with all tap targets at 44pt minimum height. The
warmup toggle becomes a small pill-shaped tap button ("W") instead of the scaled Switch.
RPE becomes a horizontal chip strip (6, 7, 8, 9, 10 - half-steps on a second line if
needed) below the weight/reps steppers. The set row splits into two lines: line 1 has
weight and reps steppers; line 2 has RPE chips. "Add set (copy last)" is a full-width
outlined button with 44pt touch height. Remove set moves to a swipe-left gesture or
a trash icon on the far right at 44pt.

Key improvement: same mental model, no structural change needed, all touch targets
meet 44pt. Easiest to implement, least disorienting to existing users.

### Direction B - "Active Set Tray" (sequential logging with keyboard-docked controls)
Sets are listed as compact summary chips (e.g., "135 lb x 8  RPE 8") above a sticky
bottom tray. The tray shows large +/- steppers for the ACTIVE set - the one being
logged now. After entering weight/reps/RPE in the tray, the user taps "Log set" (full
width, 52pt tall, primary color). The tray then auto-advances to the next set (copying
the previous values as a starting point). No keyboard is involved unless the user
explicitly taps a number to edit it via text. RPE in the tray is shown as 5 large chips
(7, 7.5, 8, 8.5, 9 most common; scroll for others).

Key improvement: eliminates the keyboard entirely for most sessions (stepper-only),
makes the active set unmistakable, and prevents the keyboard-coverage problem.

### Direction C - "Set Card Swiper" (one set at a time, full width)
Each set is a full-width card that fills most of the screen for the active exercise.
Large circular +/- buttons (56pt diameter) for weight and reps, RPE shown as a
horizontal segmented control. Swiping left logs the set and reveals the next set card.
Swiping right goes back. A mini progress row at the top shows "Set 2 of 4" as dots.
The exercise name and "last time" context appear above the card.

Key improvement: maximum tap targets, single focus point, works one-handed. Trade-off
is that seeing all sets at once requires scrolling the dot row - suitable for users who
want a "one thing at a time" flow.
