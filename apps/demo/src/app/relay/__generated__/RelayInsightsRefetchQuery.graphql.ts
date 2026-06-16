/**
 * @generated SignedSource<<6e94d23bf6a8657152e1939c2b082081>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type RelayInsightsRefetchQuery$variables = Record<PropertyKey, never>;
export type RelayInsightsRefetchQuery$data = {
  readonly " $fragmentSpreads": FragmentRefs<"insightStrip_insights">;
};
export type RelayInsightsRefetchQuery = {
  response: RelayInsightsRefetchQuery$data;
  variables: RelayInsightsRefetchQuery$variables;
};

const node: ConcreteRequest = {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "RelayInsightsRefetchQuery",
    "selections": [
      {
        "args": null,
        "kind": "FragmentSpread",
        "name": "insightStrip_insights"
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "RelayInsightsRefetchQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "Insights",
        "kind": "LinkedField",
        "name": "insights",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "open",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "inProgress",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "inReview",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "completed",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "overdue",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "unassigned",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "assignedToMe",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "dueSoon",
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "42fa02eb033214a35b43cee12bab65ed",
    "id": null,
    "metadata": {},
    "name": "RelayInsightsRefetchQuery",
    "operationKind": "query",
    "text": "query RelayInsightsRefetchQuery {\n  ...insightStrip_insights\n}\n\nfragment insightStrip_insights on Query {\n  insights {\n    open\n    inProgress\n    inReview\n    completed\n    overdue\n    unassigned\n    assignedToMe\n    dueSoon\n  }\n}\n"
  }
};

(node as any).hash = "8ebbb2dbe93b43b7465c2e508a4b87b5";

export default node;
