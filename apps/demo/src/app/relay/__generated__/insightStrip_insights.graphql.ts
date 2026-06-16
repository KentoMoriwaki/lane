/**
 * @generated SignedSource<<fad4790b64b8f790b1148dc3cc2062b8>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type insightStrip_insights$data = {
  readonly insights: {
    readonly assignedToMe: number;
    readonly completed: number;
    readonly dueSoon: number;
    readonly inProgress: number;
    readonly inReview: number;
    readonly open: number;
    readonly overdue: number;
    readonly unassigned: number;
  };
  readonly " $fragmentType": "insightStrip_insights";
};
export type insightStrip_insights$key = {
  readonly " $data"?: insightStrip_insights$data;
  readonly " $fragmentSpreads": FragmentRefs<"insightStrip_insights">;
};

import RelayInsightsRefetchQuery_graphql from './RelayInsightsRefetchQuery.graphql';

const node: ReaderFragment = {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": {
    "refetch": {
      "connection": null,
      "fragmentPathInResult": [],
      "operation": RelayInsightsRefetchQuery_graphql
    }
  },
  "name": "insightStrip_insights",
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
  ],
  "type": "Query",
  "abstractKey": null
};

(node as any).hash = "8ebbb2dbe93b43b7465c2e508a4b87b5";

export default node;
