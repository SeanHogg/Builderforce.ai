'use client';

interface PreviewFrameProps {
  url?: string;
}

export function PreviewFrame({ url }: PreviewFrameProps) {
  if (!url) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900 text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-3">🌐</div>
          <p className="text-sm">Run your project to see a preview</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-gray-200">
        <span className="text-xs text-gray-600 flex-1 truncate">{url}</span>
        <button
          onClick={() => window.open(url, '_blank')}
          className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
        >
          Open ↗
        </button>
      </div>
      <iframe
        src={url}
        className="flex-1 w-full"
        title="Preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
