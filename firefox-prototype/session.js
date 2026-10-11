// The generation counter also cancels a pending picker when Stop is pressed.
export class CaptureSession {
  constructor(getMedia, changed) {
    this.getMedia = getMedia;
    this.changed = changed;
    this.generation = 0;
    this.stream = null;
    this.state = 'idle';
  }
  publish(state, error = null) {
    this.state = state;
    this.changed({state, stream: this.stream, error});
  }
  stop() {
    this.generation++;
    const stream = this.stream;
    this.stream = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    this.publish('idle');
  }
  async start(audio) {
    this.stop();
    const generation = this.generation;
    this.publish('starting');
    try {
      const stream = await this.getMedia({video: {frameRate: {ideal: 30}}, audio});
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      const video = stream.getVideoTracks()[0];
      if (!video || video.readyState === 'ended') throw new Error('No live video track was returned.');
      video.addEventListener('ended', () => {
        if (this.stream === stream) this.stop();
      });
      this.publish('live');
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      this.publish('error', error);
    }
  }
}
