import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getReport } from '../../api/report';

const ReportPage = () => {
  const { id } = useParams();
  const [report, setReport] = useState(null);

  useEffect(() => {
    const fetchReport = async () => {
      const data = await getReport(id);
      setReport(data);
    };
    fetchReport();
  }, [id]);

  if (!report) return <div>Loading...</div>;

  return (
    <div>
      <h1>Diagnostic Report</h1>
      {/* Render report sections here */}
    </div>
  );
};

export default ReportPage;