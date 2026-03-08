import React from 'react';

export const runtime = 'edge';

// this is the projects index page, showing a list of projects
// when the platform is extended with training and AI features, this
// page will allow users to open existing projects and create new ones.

export default function ProjectsIndex() {
  // TODO: fetch project list from /api/projects
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Projects</h1>
      <p className="text-gray-500">Loading...</p>
    </div>
  );
}
