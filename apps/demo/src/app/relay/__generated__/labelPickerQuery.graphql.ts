/**
 * @generated SignedSource<<0ba4e5bf2cf7c78e50b9338ad3d1623a>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type labelPickerQuery$variables = Record<PropertyKey, never>;
export type labelPickerQuery$data = {
  readonly labels: ReadonlyArray<{
    readonly color: string;
    readonly id: string;
    readonly name: string;
  }>;
};
export type labelPickerQuery = {
  response: labelPickerQuery$data;
  variables: labelPickerQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "Label",
    "kind": "LinkedField",
    "name": "labels",
    "plural": true,
    "selections": [
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
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "labelPickerQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "labelPickerQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "340f71731843c19d738bd45a8fb2a55a",
    "id": null,
    "metadata": {},
    "name": "labelPickerQuery",
    "operationKind": "query",
    "text": "query labelPickerQuery {\n  labels {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "e91f23cbaf7f05a6645f1b1d84de94f6";

export default node;
