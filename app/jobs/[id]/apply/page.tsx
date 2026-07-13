'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export default function ApplyPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations(['jobs', 'applications']);
  const [formData, setFormData] = useState({
    coverNote: '',
  });
  const [recording, setRecording] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // TODO: Implement actual application submission API call
    // Simulate successful submission for now
    setTimeout(() => {
      router.push(`/jobs/${params.id}/application-sent`);
    }, 1500);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setRecordedVideo(URL.createObjectURL(event.data));
        }
      };

      mediaRecorder.start();
      setRecording(true);

      // Stop automatically after 3 minutes
      setTimeout(() => {
        mediaRecorder.stop();
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
      }, 180000);
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert(t('video.upload_failed'));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <button
            onClick={() => router.back()}
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('nav.back')}
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t('applications.apply_now')}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            {t('applications.application_for')} {params.id}
          </p>

          <form onSubmit={handleSubmit} className="space-y-6 mb-8">
            {/* Video Recording Section */}
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
                {t('video.record_video')}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t('video.max_duration')}
              </p>

              {!recording && !recordedVideo ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={startRecording}
                    className="w-full py-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                  >
                    <span
                      className="flex items-center justify-center gap-2"
                    >
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" />
                      </svg>
                      {t('video.record_video')}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                    {recordedVideo && (
                      <video
                        src={recordedVideo}
                        controls
                        autoPlay
                        className="w-full h-full object-cover"
                      />
                    )}
                    {recording && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center text-white">
                          <div className="spinner mx-auto mb-4"></div>
                          <p className="text-lg font-medium">{t('video.recording')}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {recordedVideo && (
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setRecordedVideo('');
                          setRecording(false);
                        }}
                        className="flex-1 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors font-medium"
                      >
                        {t('video.rerecord')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploading(true)}
                        className="flex-1 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                      >
                        {uploading ? t('video.uploading') : t('video.upload_video')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Cover Note */}
            <div>
              <label htmlFor="cover-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('applications.cover_note')}
              </label>
              <textarea
                id="cover-note"
                value={formData.coverNote}
                onChange={(e) => setFormData({ ...formData, coverNote: e.target.value })}
                rows={6}
                required
                placeholder="Tell us why you're interested in this position..."
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-700 dark:text-white resize-none"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!recordedVideo}
              className="w-full py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : t('applications.apply_now')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}