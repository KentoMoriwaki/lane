/**
 * @generated SignedSource<<ffb2692a12ae52cf2c96a363680cbdf3>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type CreateProjectInput = {
  color?: string | null | undefined;
  key?: string | null | undefined;
  name: string;
};
export type mutationsCreateProjectMutation$variables = {
  input: CreateProjectInput;
};
export type mutationsCreateProjectMutation$data = {
  readonly createProject: {
    readonly color: string;
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly taskCount: number;
  };
};
export type mutationsCreateProjectMutation = {
  response: mutationsCreateProjectMutation$data;
  variables: mutationsCreateProjectMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      }
    ],
    "concreteType": "Project",
    "kind": "LinkedField",
    "name": "createProject",
    "plural": false,
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
        "name": "key",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "color",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "taskCount",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "mutationsCreateProjectMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "mutationsCreateProjectMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "c6956ae7c7bb5c47f898ad171bc13865",
    "id": null,
    "metadata": {},
    "name": "mutationsCreateProjectMutation",
    "operationKind": "mutation",
    "text": "mutation mutationsCreateProjectMutation(\n  $input: CreateProjectInput!\n) {\n  createProject(input: $input) {\n    id\n    name\n    key\n    color\n    taskCount\n  }\n}\n"
  }
};
})();

(node as any).hash = "75d96626e45b90050fef12da2b3f9bba";

export default node;
