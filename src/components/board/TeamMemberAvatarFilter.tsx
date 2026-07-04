import React, { useState, useEffect } from 'react';

interface TeamMember {
  id: string;
  name: string;
  avatarUrl: string;
  taskCount: number;
}

interface TeamMemberAvatarFilterProps {
  members: TeamMember[];
  tasks: any[];
  onFilterChange: (selectedIds: string[]) => void;
}

const TeamMemberAvatarFilter: React.FC<TeamMemberAvatarFilterProps> = ({ members, tasks, onFilterChange }) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [allSelected, setAllSelected] = useState(false);

  useEffect(() => {
    const selectedIds = selectedKeys.length > 0 ? selectedKeys : null;
    onFilterChange(selectedIds);
  }, [selectedKeys, onFilterChange]);

  const handleToggle = (id: string) => {
    setSelectedKeys(prev => 
      prev.includes(id)
        ? prev.filter(key => key !== id)
        : [...prev, id]
    );
  };

  const handleClear = () => {
    setSelectedKeys([]);
    setAllSelected(false);
  };

  return (
    <div className="flex flex-wrap gap-2 p-2 bg-gray-100 rounded">
      {members.map(member => (
        <div
          key={member.id}
          className={`flex items-center px-3 py-1 rounded-full cursor-pointer transition-all ${
            selectedKeys.includes(member.id)
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
          onClick={() => handleToggle(member.id)}
        >
          <img src={member.avatarUrl} alt={member.name} className="w-8 h-8 rounded-full mr-2" />
          <span>{member.name}</span>
          <span className="ml-2 text-xs bg-gray-300 rounded px-1.5 py-0.5">
            {member.taskCount}
          </span>
        </div>
      ))}
      <div
        className={`flex items-center px-3 py-1 rounded-full cursor-pointer transition-all ${
          allSelected
            ? 'bg-blue-500 text-white' 
            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
        }`}
        onClick={handleClear}
      >
        <span>All</span>
      </div>
    </div>
  );
};

export default TeamMemberAvatarFilter;