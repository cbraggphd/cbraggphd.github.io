# Doc Reader (web page)

Turns a PDF, Word (.docx) or text file into an MP3 recording, entirely inside the
browser. No files are uploaded. The page is unlisted (`noindex`) and nothing links to it.

## Files

- `index.html`: the whole page (layout, text clean-up, queue, player).
- `tts-worker.js`: the voice engine (Kokoro voice model + MP3 encoder), built from
  `src/tts-worker.src.js` with `build.sh`. Rebuild only if the engine changes.
- `sw.js`: adds the two headers that let the engine use several processor cores,
  and keeps a copy of the page for when there is no signal.
- `vendor/`: PDF reader (pdf.js) and the ONNX runtime the voice model runs on.
- `fonts/`: Atkinson Hyperlegible (SIL Open Font License).

## What comes from elsewhere

The voice model downloads once from huggingface.co
(`onnx-community/Kokoro-82M-v1.0-ONNX`, about 326 MB on a computer, 92 MB on a
phone) and is then kept by the browser. Documents and recordings never leave the device.

## Text clean-up rules (in `index.html`, section 3)

Running headers, footers and page numbers are dropped; words split across lines
are rejoined; citations such as (Smith, 2020) and [12] are left out; the reference
list is skipped; statistics symbols are spoken ("p less than .05").
