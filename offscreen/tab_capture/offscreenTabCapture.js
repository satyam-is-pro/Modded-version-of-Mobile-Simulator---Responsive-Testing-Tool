const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

const recorded_chunks = [];
let media_recorder;

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target === 'offscreen') {
      switch (message.type) {
        case 'mf-start-recording':
          await startRecording(message.stream_id, message.measurement, message.video_quality);
          break;
        case 'mf-stop-recording':
          await stopRecording(message);
          break;
        default:
          throw new Error('Unrecognized message:', message.type);
      }
    }
});
  
async function startRecording(stream_id, measurement, video_quality) {
    if (media_recorder?.state === 'recording') {
        throw new Error('Called startRecording while recording is in progress.');
    }
    window.location.hash = 'recording';

    const media_stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: stream_id
            }
        }
    });
    video.srcObject = media_stream;
    video.onloadedmetadata = () => {
        video.play();
        captureCanvasStream(measurement, video_quality);
    };
}

async function captureCanvasStream(measurement, video_quality) {

    let frameRate, mbps, max_height;
    if(video_quality === 'high') {
        mbps = 40000000;
        frameRate = 60;
        max_height = 10000;
    } else if(video_quality === 'medium') {
        mbps = 25000000;
        frameRate = 30;
        max_height = 2000;
    } else {
        mbps = 10000000;
        frameRate = 15;
        max_height = 1000;
    }

    let devicePixelRatio = window.devicePixelRatio;
    let aspect_ratio_video = video.videoWidth / video.videoHeight;
    let aspect_ratio_window = measurement.window_width / measurement.window_height;

    let ratio = 1;
    if(aspect_ratio_window > 1)
        ratio = Math.min(measurement.window_height * devicePixelRatio, max_height) / (measurement.window_height * devicePixelRatio);

    let scale, calculated_top, calculated_left;
    if (aspect_ratio_window < aspect_ratio_video) {
        scale = video.videoHeight / (measurement.window_height * devicePixelRatio);
        calculated_top = scale * measurement.top * devicePixelRatio;
        calculated_left = ((video.videoWidth - (scale * measurement.window_width * devicePixelRatio)) / 2) + (scale * measurement.left * devicePixelRatio);
    } else {
        scale = video.videoWidth / (measurement.window_width * devicePixelRatio);
        calculated_top = ((video.videoHeight - (scale * measurement.window_height * devicePixelRatio)) / 2) + (scale * measurement.top * devicePixelRatio);
        calculated_left = scale * measurement.left * devicePixelRatio;
    }

    canvas.width = scale * measurement.width * devicePixelRatio * ratio + (1 * devicePixelRatio);
    canvas.height = scale * measurement.height * devicePixelRatio * ratio;
    
    ctx.scale(ratio, ratio);

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let width = canvas.width * 1 / ratio;
    let height = canvas.height * 1 / ratio;

    (function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Effacer le canvas
        ctx.drawImage(video, calculated_left, calculated_top, width, height, 0, 0, width, height);
        setTimeout(loop, 1000/frameRate);
    })();

    const stream = canvas.captureStream(frameRate);

    const options = { 
        videoBitsPerSecond : mbps, // 40 Mbps
        frameRate
    };
    if(MediaRecorder.isTypeSupported('video/webm;codecs=h264'))
        options.mimeType = 'video/webm;codecs=h264';
    else if(MediaRecorder.isTypeSupported('video/webm;codecs=vp9'))
        options.mimeType = 'video/webm;codecs=vp9';
    else
        options.mimeType = 'video/webm';

    media_recorder = new MediaRecorder(stream, options);
    
    media_recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recorded_chunks.push(event.data);
        }
    }

    // Lancement de l'enregistrement
    media_recorder.start(1000);
}

async function stopRecording(message) {

    media_recorder.stop();
    media_recorder.stream.getTracks().forEach((t) => t.stop());
    window.location.hash = '';

    const blob = new Blob(recorded_chunks, { type: 'video/webm' });
    let url = window.URL.createObjectURL(blob);

    chrome.runtime.sendMessage({ action: 'tab_capture_video_generated', tabId: message.tabId, url }); 
}