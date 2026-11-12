/* Web Worker: owns opencv.js and the engine, so the page never freezes.
 * in : {type:'job', id, image:{rgba,width,height}, mask, faces, shortSide, params}
 *      {type:'params', id, params}            re-render the current photo with new slider values
 * out: {type:'ready'} | {type:'progress', id, p, label} | {type:'result', id, width, height, rgba, ms, stats}
 *      {type:'error', id, message}
 */
'use strict';
importScripts('../vendor/opencv.js', 'engine.js');

const cvReady = new Promise((resolve) => {
  if (self.cv && self.cv.Mat) resolve();
  else self.cv.onRuntimeInitialized = () => resolve();
});
cvReady.then(() => self.postMessage({ type: 'ready' }));

let state = null, stateId = null;

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    await cvReady;
    const t0 = performance.now();
    const progress = (p, label) => self.postMessage({ type: 'progress', id: msg.id, p, label });
    if (msg.type === 'job') {
      state = null; stateId = null;
      state = PencilEngine.prepare({
        rgba: msg.image.rgba, width: msg.image.width, height: msg.image.height,
        mask: msg.mask, faces: msg.faces, shortSide: msg.shortSide,
      }, progress);
      stateId = msg.id;
    } else if (msg.type !== 'params' || !state || msg.id !== stateId) {
      return;
    }
    const rgba = PencilEngine.render(state, msg.params, progress);
    self.postMessage({
      type: 'result', id: msg.id, width: state.W, height: state.H, rgba,
      ms: Math.round(performance.now() - t0), stats: state.stats, full: msg.type === 'job',
    }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};
