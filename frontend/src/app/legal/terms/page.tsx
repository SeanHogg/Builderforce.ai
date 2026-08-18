import { LegalDocumentPage, legalDocumentMetadata } from '@/components/legal/LegalDocumentPage';

export const generateMetadata = () => legalDocumentMetadata('terms');

export default function Page() {
  return <LegalDocumentPage type="terms" />;
}
