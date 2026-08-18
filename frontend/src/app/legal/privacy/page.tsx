import { LegalDocumentPage, legalDocumentMetadata } from '@/components/legal/LegalDocumentPage';

export const generateMetadata = () => legalDocumentMetadata('privacy');

export default function Page() {
  return <LegalDocumentPage type="privacy" />;
}
