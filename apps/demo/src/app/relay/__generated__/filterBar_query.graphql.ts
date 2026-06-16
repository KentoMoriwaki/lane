/**
 * @generated SignedSource<<edb4f8b11592414bb5a54697edd2fa33>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type filterBar_query$data = {
  readonly labels: ReadonlyArray<{
    readonly color: string;
    readonly id: string;
    readonly name: string;
  }>;
  readonly projects: ReadonlyArray<{
    readonly color: string;
    readonly id: string;
    readonly name: string;
  }>;
  readonly " $fragmentType": "filterBar_query";
};
export type filterBar_query$key = {
  readonly " $data"?: filterBar_query$data;
  readonly " $fragmentSpreads": FragmentRefs<"filterBar_query">;
};

const node: ReaderFragment = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "id",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "name",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "color",
    "storageKey": null
  }
];
return {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "filterBar_query",
  "selections": [
    {
      "alias": null,
      "args": null,
      "concreteType": "Project",
      "kind": "LinkedField",
      "name": "projects",
      "plural": true,
      "selections": (v0/*:: as any*/),
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Label",
      "kind": "LinkedField",
      "name": "labels",
      "plural": true,
      "selections": (v0/*:: as any*/),
      "storageKey": null
    }
  ],
  "type": "Query",
  "abstractKey": null
};
})();

(node as any).hash = "8ac9ad897a29e65df85b078ce08cab8f";

export default node;
