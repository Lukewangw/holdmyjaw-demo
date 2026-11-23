# Hold My Jaw

Live demo: https://lukewangw.github.io/holdmyjaw-demo/

A speech recording is compressed into a short plan of articulatory gestures (dynamic movement primitives on tract
variables). Our body model turns the plan into lip, tongue and jaw movements, and the jaw drives J5 of the VERA robot
face. Head nods and gaze come from the same event layer. Pick a sentence or a song, press play, and open X-ray to see the
articulators inside the head. Loads (a weight on the jaw, a pen between the teeth, a band, gum, a hand, the table) play
our own synthesized voice with reflexes on or off, so the compensation can be heard.

The page is static: `python -m http.server` in this folder, then open http://localhost:8000.

Credits: speech from LibriTTS-R and singing from VocalSet (both CC BY 4.0); body model fitted to MNGU0; the head is a
modular interpretation of the VERA concept drawings (Figs. 1, 3 and 4). Rendered with three.js and the
[Studio Small 08](https://polyhaven.com/a/studio_small_08) lighting environment by Sergej Majboroda (CC0).
