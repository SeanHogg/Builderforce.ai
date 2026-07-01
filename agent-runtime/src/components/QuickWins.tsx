import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const QuickWins = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch quick wins from API
    fetch('/api/tasks/quick-wins')
      .then(response => response.json())
      .then(data => {
        setTasks(data.tasks);
        setLoading(false);
      })
      .catch(error => {
        console.error('Error fetching quick wins:', error);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div>Loading quick wins...</div>;
  }

  if (tasks.length === 0) {
    return <div>No quick wins available</div>;
  }

  return (
    <div className="quick-wins">
      <h2>Top 5 Quick Wins</h2>
      <ul>
        {tasks.map(task => (
          <li key={task.id}>
            <Link to={`/tasks/${task.id}`}>{task.title}</Link>
            <span> ({task.estimate} hours)</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default QuickWins;