'use client';

import { Avatar } from "@/components/Avatar"; // Assuming an Avatar component exists
import type { TeamMember } from "@/lib/taskAssignee"; // Assuming TeamMember type is available

type TeamMemberAvatarFilterProps = {
  members: TeamMember[];
  selectedMemberIds: string[];
  onSelectMember: (memberId: string) => void;
  taskCounts: Record<string, number>; // Map of memberId to task count
};

export function TeamMemberAvatarFilter({
  members,
  selectedMemberIds,
  onSelectMember,
  taskCounts,
}: TeamMemberAvatarFilterProps) {
  return (
    <div className="flex items-center space-x-2 overflow-x-auto p-2">
      {/* "All" or "Clear" button */}
      <button
        onClick={() => onSelectMember("all")} // Special value to indicate "all"
        className={`flex flex-col items-center p-1 rounded-md cursor-pointer transition-colors ${
          selectedMemberIds.includes("all") || selectedMemberIds.length === 0
            ? "bg-blue-500 text-white"
            : "hover:bg-gray-200 dark:hover:bg-gray-700"
        }`}
      >
        <Avatar name="All" size="sm" />
        <span className="text-xs font-medium mt-0.5">All</span>
      </button>

      {members.map((member) => (
        <button
          key={member.id}
          onClick={() => onSelectMember(member.id)}
          className={`flex flex-col items-center p-1 rounded-md cursor-pointer transition-colors ${
            selectedMemberIds.includes(member.id)
              ? "bg-blue-500 text-white"
              : "hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          <div className="relative">
            <Avatar name={member.name} size="sm" />
            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-700 text-white text-xs font-bold">
              {taskCounts[member.id] || 0}
            </span>
          </div>
          <span className="text-xs font-medium mt-0.5 truncate max-w-[60px]">
            {member.name}
          </span>
        </button>
      ))}
    </div>
  );
}
