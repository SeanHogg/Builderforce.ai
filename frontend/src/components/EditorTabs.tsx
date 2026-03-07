'use client';

interface EditorTabsProps {
  openFiles: string[];
  activeFile?: string;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function EditorTabs({ openFiles, activeFile, onTabSelect, onTabClose }: EditorTabsProps) {
  if (openFiles.length === 0) return null;

  return (
    <div className="flex items-center bg-gray-900 border-b border-gray-700 overflow-x-auto">
      {openFiles.map(file => (
        <div
          key={file}
          className={`flex items-center gap-2 px-3 py-2 border-r border-gray-700 cursor-pointer text-sm whitespace-nowrap group ${
            activeFile === file
              ? 'bg-gray-800 text-white border-t-2 border-t-blue-500'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          }`}
          onClick={() => onTabSelect(file)}
        >
          <span>{getFileName(file)}</span>
          <button
            className="opacity-0 group-hover:opacity-100 hover:text-white text-gray-500 leading-none"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(file);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
