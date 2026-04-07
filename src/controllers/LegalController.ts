import { promises as fs } from 'fs';
import path from 'path';
import { Controller, Get, Path, Query, Route, Tags, SuccessResponse } from 'tsoa';
import { Errors } from '../middleware/errorHandler';
import { LEGAL_VERSIONS, LegalDocType, normalizeLegalLang } from '../utils/legalVersions';

interface LegalVersionsResponse {
  terms: string;
  privacy: string;
}

interface LegalDocumentResponse {
  type: LegalDocType;
  lang: 'ko' | 'en' | 'ja';
  version: string;
  content: string;
}

const VALID_TYPES: ReadonlySet<LegalDocType> = new Set(['terms', 'privacy']);

@Route('legal')
@Tags('Legal')
export class LegalController extends Controller {
  /**
   * 현재 약관/개인정보 처리방침 버전.
   * 클라이언트는 사용자의 동의 버전과 비교하여 재동의 필요 여부를 판단할 수 있다.
   * @summary 약관 현재 버전 조회
   */
  @Get('versions')
  @SuccessResponse(200, '성공')
  public async getVersions(): Promise<LegalVersionsResponse> {
    return { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy };
  }

  /**
   * 특정 약관 본문(Markdown) 조회.
   * @param type 'terms' 또는 'privacy'
   * @param lang 'ko' | 'en' | 'ja' (기본 ko)
   * @summary 약관 본문 조회
   */
  @Get('{type}')
  @SuccessResponse(200, '성공')
  public async getDocument(
    @Path() type: string,
    @Query() lang?: string
  ): Promise<LegalDocumentResponse> {
    if (!VALID_TYPES.has(type as LegalDocType)) {
      throw Errors.badRequest(`Unknown legal document type: ${type}`);
    }
    const docType = type as LegalDocType;
    const normalizedLang = normalizeLegalLang(lang);

    // type === 'terms'  → terms-{lang}.md
    // type === 'privacy'→ privacy-policy-{lang}.md
    const fileName = docType === 'terms'
      ? `terms-${normalizedLang}.md`
      : `privacy-policy-${normalizedLang}.md`;

    const filePath = path.join(__dirname, '..', '..', 'public', 'legal', fileName);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      throw Errors.notFound(`약관 문서 (${fileName})`);
    }

    return {
      type: docType,
      lang: normalizedLang,
      version: LEGAL_VERSIONS[docType],
      content,
    };
  }
}
