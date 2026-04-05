import React, { useEffect, useRef, useState } from 'react';

const CAPTURE_JPEG_QUALITY = 0.85;

/**
 * Small self-view camera preview. Uses getUserMedia; works when desktop app has granted camera permission.
 * If cameraCaptureRef is passed, it will be set to { captureFrame } so the parent can send the current frame to the LLM.
 */
export function CameraPreview({ show = false, className = '', cameraCaptureRef }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!show) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (cameraCaptureRef) cameraCaptureRef.current = null;
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Camera unavailable');
      });

    return () => {
      cancelled = true;
      if (cameraCaptureRef) cameraCaptureRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [show, cameraCaptureRef]);

  useEffect(() => {
    if (!show || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
  }, [show]);

  // Expose captureFrame to parent when we have a stream (video may still be loading)
  useEffect(() => {
    if (!cameraCaptureRef || !show) return;
    const stream = streamRef.current;
    if (!stream) {
      cameraCaptureRef.current = null;
      return;
    }
    cameraCaptureRef.current = {
      captureFrame: () =>
        new Promise((resolve, reject) => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) {
            resolve(null);
            return;
          }
          try {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (!w || !h) {
              resolve(null);
              return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(video, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', CAPTURE_JPEG_QUALITY);
            const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
            resolve({ data: base64, media_type: 'image/jpeg' });
          } catch (e) {
            reject(e);
          }
        }),
    };
    return () => {
      cameraCaptureRef.current = null;
    };
  }, [show, cameraCaptureRef, error]);

  if (!show) return null;

  return (
    <div className={`camera-preview ${className}`}>
      {error ? (
        <span className="camera-preview__error" title={error}>
          Camera off
        </span>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-preview__video"
          aria-label="Camera preview"
        />
      )}
    </div>
  );
}

export default CameraPreview;
