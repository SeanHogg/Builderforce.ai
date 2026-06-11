import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import './styles/global.css';
import Navbar from './components/Navbar';
import ProjectList from './components/ProjectList';
import TaskList from './components/TaskList';
import FileUpload from './components/FileUpload';

function App() {
  return (
    <Router>
      <Navbar />
      <main style={styles.mainContent}>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/:projectId/tasks" element={<TaskList />} />
          <Route path="/projects/:projectId/upload" element={<FileUpload />} />
          {/* Add more routes as needed */}
        </Routes>
      </main>
    </Router>
  );
}

const styles = {
  mainContent: {
    flexGrow: 1,
    padding: '1rem',
    overflowY: 'auto', /* Allows scrolling within the main content area */
  }
};

export default App;