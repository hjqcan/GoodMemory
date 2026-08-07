const CATEGORY_BY_CODE = {
  a: "adversarial",
  m: "multi_hop",
  o: "open_domain",
  s: "single_hop",
  t: "temporal",
} as const;

const FROZEN_CATEGORY_CODES_BY_CASE = {
  "locomo-conv-26": "ttommttmtttmtmomttmmttommttottotmtmttmmmmtomttommtommttmmttommttommttommtttmmomttossssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-30": "ttsmsmtttmtttttttmmttttmmmtmtmtmtttttttssssssssssssssssssssssssssssssssssssssssassaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-41": "ttmmttmmomtmmtomtommtmtmtmmtmmmtmmtmmmtomomtmotmtmotmttttmttmtmtosssssssssssssssssssssssssstssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-42": "omttomttttmmotottttmtttmtttmttmtttmtttttttmtttmmtmmmmmtmmtmmommmttomommmtommmtmmmmmmootosssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-43": "mmmomotmomtmtmmotmmotmtttmmoommtotommtmttmmmttttmmmomotttmtmtmmttmoottosssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-44": "ttmmtttttmttmtmmtmmoomtmmtmmmmtmmotmmttmmmmootttmmmmoomtmtttmssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-47": "otmmtmoommttotttoomomtmtmommttottomootmtmtttomtttmtmttmtmtttmttttttsssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-48": "tmtttomtmttotmmsstommttomsttottttsttottmomstttttosttttttttsstssssttstsotsmsotmtmmtmmmmmmmssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-49": "mmmmtommmtomttmmmtmoomttttmommtommmtmmotttmomtotmmmottmmmottttmtmotttmtomttttmmttmmsssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "locomo-conv-50": "tmtmommotttmtotmttmmmommmtttmmmtmmtttotommottmmmtmtttmmtmtmmmttmmtmttttsssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

export interface FrozenV073LocomoQuestionIdentity {
  caseId: string;
  category: "multi_hop" | "open_domain" | "single_hop" | "temporal";
  questionId: string;
}

export function frozenV073LocomoQuestionSelection(): FrozenV073LocomoQuestionIdentity[] {
  return Object.entries(FROZEN_CATEGORY_CODES_BY_CASE).flatMap(
    ([caseId, codes]) => [...codes].flatMap((code, index) => {
      const category = CATEGORY_BY_CODE[code as keyof typeof CATEGORY_BY_CODE];
      return category === "adversarial"
        ? []
        : [{ caseId, category, questionId: `${caseId.slice(7)}:q${index}` }];
    }),
  );
}
