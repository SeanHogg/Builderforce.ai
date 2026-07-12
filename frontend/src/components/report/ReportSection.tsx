import { useState, useEffect } from 'react';
import { getReport } from '../../api/report';

const ReportSection = ({ section }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await getReport(section);
      setData(result);
    };
    fetchData();
  }, [section]);

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <h3>{section}</h3>
      {/* Render section content here */}
    </div>
  );
};

export default ReportSection;