// Forwards each mono render block to the main thread, where
// lib/audio/pcm16.ts downsamples it to 16 kHz PCM16.
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
