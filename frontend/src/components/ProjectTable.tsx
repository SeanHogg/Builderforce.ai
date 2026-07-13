'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalBrainContext } from '@/lib/brain';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { ProjectCard } from './ProjectCard';
import { useProjects } from '@/hooks/useProjects';

export default function ProjectTable() {
  const { isAuthenticated, hasTenant } = useAuth();
  const brain = useOptionalBrainContext();
  const { projects, loading, error } = useProjects();
  const [filteredProjects, setFilteredProjects] = useState(projects);

  useEffect(() => {
    if (projects.length > 0) {
      setFilteredProjects(projects);
    }
  }, [projects]);

  if (!isAuthenticated || !hasTenant) return null;

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div style={{ padding: '20px 16px' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 16 }}>Projects</h2>
      <TableContainer style={{ maxHeight: '600px', overflow: 'auto' }}>
        <Table stickyHeader aria-label="project table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Name</TableCell>
              <TableCell style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Description</TableCell>
              <TableCell style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Status</TableCell>
              <TableCell style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Last Updated</TableCell>
              <TableCell style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredProjects.map((project) => (
              <TableRow key={project.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <TableCell component="th" scope="row">
                  <Link href={`/projects/${project.slug}?p=${project.id}`} style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}>
                    {project.name}
                  </Link>
                </TableCell>
                <TableCell>{project.description || 'No description'}</TableCell>
                <TableCell>
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    borderRadius: 99,
                    backgroundColor: project.status === 'active' ? 'var(--surface-success-soft)' : 'var(--bg-elevated)',
                    color: project.status === 'active' ? 'var(--surface-success)' : 'var(--text-secondary)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    fontWeight: 600
                  }}>
                    {project.status}
                  </span>
                </TableCell>
                <TableCell>{new Date(project.updatedAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Link href={`/projects/${project.slug}?p=${project.id}`} style={{ color: 'var(--coral-bright)', textDecoration: 'none', fontSize: '0.875rem' }}>
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}