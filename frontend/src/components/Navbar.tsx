import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const Navbar: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  return (
    <header style={styles.header}>
      <div style={styles.container}>        <Link to="/" style={styles.logo}>BuilderForce.ai</Link>
        
        {/* Hamburger menu for mobile */}
        <button
          onClick={toggleMenu}
          style={styles.hamburger}
          aria-label="Toggle menu"
        >
          <span style={styles.hamburgerLine}></span>
          <span style={styles.hamburgerLine}></span>
          <span style={styles.hamburgerLine}></span>
        </button>
        
        {/* Navigation links */}
        <nav style={{ ...styles.nav, ...(menuOpen ? styles.navOpen : {}) }}>
          <ul style={styles.navList}>
            <li style={styles.navItem}>
              <Link to="/" style={styles.navLink}>
                Projects
              </Link>
            </li>
            <li style={styles.navItem}>
              <Link to="/" style={styles.navLink} onClick={(e) => { e.preventDefault(); /* Placeholder */ }}>Tasks</Link>
            </li>
            <li style={styles.navItem}>
              <Link to="/" style={styles.navLink} onClick={(e) => { e.preventDefault(); /* Placeholder */ }}>Messages</Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
};

const styles = {
  header: {
    backgroundColor: '#007bff',
    color: 'white',
    padding: '1rem 0',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
  },
  container: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 1rem',
    width: '100%',
  },
  logo: {
    color: 'white',
    fontSize: '1.25rem',
    fontWeight: 'bold',
  },
  hamburger: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-around',
    width: '2rem',
    height: '1.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    zIndex: 10,
    // Show only on mobile
    '@media (min-width: 768px)': {
      display: 'none'
    }
  },
  hamburgerLine: {
    width: '100%',
    height: '0.25rem',
    backgroundColor: 'white',
    borderRadius: '0.125rem'
  },
  nav: {
    // Hide by default on mobile
    '@media (max-width: 767.9px)': {
      position: 'absolute' as const,
      top: '100%',
      left: 0,
      width: '100%',
      backgroundColor: '#007bff',
      flexDirection: 'column' as const,
      padding: '1rem 0',
      clipPath: 'circle(0px at 90% -10%)',
      transition: 'clip-path 0.5s ease-in-out'
    }
  },
  navOpen: {
    // Show full screen nav on mobile when open
    '@media (max-width: 767.9px)': {
      clipPath: 'circle(1000px at 90% -10%)',
    }
  },
  navList: {
    display: 'flex',
    listStyle: 'none',
    // On mobile, stack vertically
    '@media (max-width: 767.9px)': {
      flexDirection: 'column' as const,
      alignItems: 'center'
    }
  },
  navItem: {
    margin: '0 1rem',
    // On mobile, add spacing
    '@media (max-width: 767.9px)': {
      margin: '0.5rem 0'
    }
  },
  navLink: {
    color: 'white',
    fontSize: '1rem',
    fontWeight: 500,
    padding: '0.5rem 0',
    // Ensure touch targets are large enough
    display: 'block',
    minHeight: '44px',
    minWidth: '44px',
    display: 'flex',
    alignItems: 'center'
  }
};

export default Navbar;