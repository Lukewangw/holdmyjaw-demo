# Hold My Jaw

Live demo: https://lukewangw.github.io/holdmyjaw-demo/

The demo plays the original recording for eight sentences and three sung clips. The lower-left X-ray shows our model’s
predicted tongue, lip and jaw motion. The gestural score shows the tract-variable gestures that drive the body model.
The motor-plan byte count describes those gestures. Synthesizing a voice also uses pitch, loudness and speaker information.

Predicted mouth opening drives the simulated J5 jaw and its crank linkage. The event readout exposes the target, onset
and duration that a VERA controller could consume. J2 beat nods and J3/J4 gaze illustrate rule-based cues on the same
timeline. Mapping these targets to physical actuators requires calibration on VERA.

Choose a weight, pen, band, gum, hand or table to hear pre-rendered model speech under that load. Switch reflexes on or
off to compare the same utterance. Selecting the load again restores the original recording.

The page is static: `python -m http.server` in this folder, then open http://localhost:8000.

Credits: speech from LibriTTS-R and singing from VocalSet (both CC BY 4.0); body model fitted to MNGU0; the head is a
modular interpretation of the VERA concept drawings (Figs. 1, 3 and 4). Rendered with three.js and the
[Studio Small 08](https://polyhaven.com/a/studio_small_08) lighting environment by Sergej Majboroda (CC0).
