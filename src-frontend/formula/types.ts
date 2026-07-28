/**
 * formula/types.ts
 * 鍏紡搴撶被鍨嬪畾涔? *
 * 璁捐鍘熷垯锛氭瘡鏉″叕寮忓繀椤诲寘鍚?濡備綍瀹炵幇"鎻忚堪锛岃鐢ㄦ埛涓嶄粎鑳借儗鍏紡锛岃繕鑳界悊瑙ｅ姩浣滃師鐞? */

export type FormulaCategory = 'F2L' | 'OLL' | 'PLL';

export interface FormulaVariant {
  /** ALGDB 椋庢牸鐨勫彲閫夎В娉曞悕绉帮紝渚嬪鈥滀富瑙ｂ€濃€淯 鍓嶇疆鈥?*/
  name: string;
  /** 璇ヨВ娉曠殑杞姩搴忓垪 */
  moves: string[];
  /** 棰濆鎻愮ず锛屼緥濡傞€傚悎鐨勮捣鎵嬭搴?*/
  note?: string;
}

export interface Formula {
  /** 鍞竴鏍囪瘑锛屽 "F2L-01", "OLL-21", "PLL-T-Perm" */
  id: string;
  /** 鍏紡鎵€灞為樁娈?*/
  category: FormulaCategory;
  /** 浜虹被鍙鍚嶇О */
  name: string;
  /** 妗堜緥鍥撅紙鏆傛椂鐢?ASCII 鏂囨湰鎴?emoji锛?*/
  caseImage: string;
  /** 鍏紡搴忓垪 */
  moves: string[];
  /** 鍙€夎В娉曪紝鏈彁渚涙椂 UI 浼氳嚜鍔ㄧ敓鎴?3-4 涓彲閫夎捣鎵嬭搴?*/
  setupMoves?: string[];
  variants?: FormulaVariant[];
  /** 濡備綍璇嗗埆杩欎釜 case锛氳瀵熶粈涔堢壒寰?*/
  recognition: string;
  /** 濡備綍鎵ц锛氭墜鎸囧姩浣溿€佸叧閿楠ゆ媶瑙?*/
  execution: string;
  /** 闅惧害 1-5锛?=鍩烘湰锛?=楂橀樁 */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** 鏍囩锛屾柟渚跨瓫閫夊拰鎺ㄨ崘 */
  tags: string[];
  /** 鏉ユ簮锛堝彲閫夛級锛氫緥濡?"J Perm", "algdb.net" */
  source?: string;
}

/**
 * 鍏紡搴撶瓫閫夋潯浠? */
export interface FormulaQuery {
  category?: FormulaCategory;
  tags?: string[];
  difficulty?: number;
  search?: string;
}

/**
 * 鍏紡搴撴帹鑽愮粨鏋滐紙AGENT 璋冪敤锛? */
export interface FormulaRecommendation {
  reason: string;              // 涓轰粈涔堟帹鑽愯繖浜?  formulas: Formula[];         // 鎺ㄨ崘鐨勫叕寮忓垪琛?  practicePlan: string;        // 缁冧範璁″垝
  formulas: Formula[];
  practicePlan: string;
}
