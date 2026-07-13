import { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Budget & Resources',
  description: 'Real-time budget variance, headcount planning, and AI resource tracking'
};

export default function BudgetLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Budget & Resources</h1>
        {children}
      </div>
    </div>
  );
}