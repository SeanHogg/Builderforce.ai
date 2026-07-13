import React, { useState } from 'react';
import Link from 'next/link';

const Navbar: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  return (
    <header style={styles.header}>
      <div style={styles.container}>
        {/* Logo - using text for simplicity, can be Image component */}
        <Link href="/" style={styles.logo}>BuilderForce.ai</Link>

        {/* Hamburger menu for mobile */}
        <button
          onClick={toggleMenu}
          style={styles.hamburger}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span style={styles.hamburgerLine}></span>
          <span style={styles.hamburgerLine}></span>
          <span style={styles.hamburgerLine}></span>
        </button>

        {/* Navigation links - responsive toggling */}
        <nav style={{ ...(menuOpen ? styles.navOpen : styles.navClosed) }}>
          <ul style={styles.navList}>
            <li style={styles.navItem}>
              <Link href="/projects" style={styles.navLink} onClick={() => setMenuOpen(false)}>
                Projects
              </Link>
            </li>
            <li style={styles.navItem}>
              <Link href="/tasks" style={styles.navLink} onClick={() => setMenuOpen(false)}>
                Tasks
              </Link>
            </li>
            <li style={styles.navItem}>
              <Link href="/notifications" style={styles.navLink} onClick={() => setMenuOpen(false)}>
                Messages
              </Link>
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
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    position: 'sticky',
    top: 0,
    zIndex: 100
  },
  container: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 1rem',
    width: '100%'
  },
  logo: {
    color: 'white',
    fontSize: '1.25rem',
    fontWeight: 'bold'
  },
  hamburger: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-around',
    width: '44px',
    height: '44px',
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
  navClosed: {
    // Hide by default on mobile
    '@media (max-width: 767.9px)': {
      position: 'fixed',
      top: '60px',
      left: 0,
      width: '100%',
      backgroundColor: '#007bff',
      flexDirection: 'column' as const,
      padding: '1rem 0',
      clipPath: 'circle(0px at 90% -10%)',
      transition: 'clip-path 0.5s ease-in-out',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    }
  },
  navOpen: {
    // Show full screen nav on mobile when open
    '@media (max-width: 767.9px)': {
      clipPath: 'circle(1000px at 90% -10%)'
    }
  },
  navList: {
    display: 'flex',
    listStyle: 'none',
    width: '100%',
    // On mobile, stack vertically
    '@media (max-width: 767.9px)': {
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: '0.5rem'
    }
  },
  navItem: {
    margin: '0 1rem',
    width: '100%',
    textAlign: 'center',
    // On mobile, add spacing
    '@media (max-width: 767.9px)': {
      margin: '0.5rem 0'
    }
  },
  navLink: {
    color: 'white',
    fontSize: '1rem',
    fontWeight: 500,
    padding: '0.75rem 1.5rem',
    display: 'block',
    minHeight: '48px',
    minWidth: '48px',
    display: 'flex',
    alignItems: 'center',
    transition: 'opacity 0.2s',
    borderRadius: '8px'
  }
};

export default Navbar;