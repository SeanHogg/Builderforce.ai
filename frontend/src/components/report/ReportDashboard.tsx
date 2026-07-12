import { useState, useEffect } from 'react';
import { getReport } from '../../api/report';

const ReportDashboard = () => {
  const [reports, setReports] = useState([]);

  useEffect(() => {
    const fetchReports = async () => {
      const data = await getReport();
      setReports(data);
    };
    fetchReports();
  }, []);

  return (
    <div>
      <h2>Reports Dashboard</h2>
      {/* Render report list and summary here */}
    </div>
  );
};

export default ReportDashboard;