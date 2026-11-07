/** The api words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface ApiLabels {
    /** `{file}`, `{count}`, `{names}`, `{routes}`. */
    api: Record<
        'notSetUpTitle' | 'notSetUpBody' | 'kpiEndpoints' | 'kpiParams' | 'kpiCallers' | 'kpiTests' | 'kpiContract' | 'pickFile' | 'paramWithNote' | 'kpiUndocumented' | 'contractMissing' | 'documented' | 'undocumented' | 'callers'
        | 'noCallers' | 'downloadFailed' | 'tryIt' | 'requestLine' | 'copyCurl' | 'exportOpenapi' | 'exportPostman' | 'contractTests' | 'contractTestsText'
        | 'groupInContract' | 'groupUndocumented' | 'selectEndpoint' | 'selectedCount' | 'selectAtLeastOne' | 'detailParams' | 'paramPath' | 'paramQuery' | 'paramBody'
        | 'paramBodyNote' | 'noParams' | 'detailTested' | 'testedYes' | 'testedNo' | 'testedBy' | 'testedNone' | 'detailCallers' | 'callerFilesNone' | 'sandboxTitle'
        | 'baseUrl' | 'baseUrlInvalid' | 'baseUrlRemote' | 'paramValue' | 'paramMissing' | 'bodyInvalid' | 'bodyLabel' | 'send' | 'sending' | 'sendUnavailable'
        | 'sendFailed' | 'resultStatus' | 'resultHeaders' | 'resultBody' | 'resultTruncated' | 'resultEmpty',
        string
    >;
}

export const API_DEFAULTS: ApiLabels = {
    api: {
        notSetUpTitle: 'No endpoints found',
        notSetUpBody: 'No route registration was found. Routes are read from Hono and Express registrations.',
        kpiEndpoints: 'Endpoints',
        kpiParams: 'Parameters',
        kpiCallers: 'Callers',
        kpiTests: 'Test files',
        kpiContract: 'Contract',
        pickFile: 'Select {name} on the map',
        paramWithNote: '{where} · {note}',
        kpiUndocumented: 'Undocumented',
        contractMissing: 'There is no OpenAPI contract in this folder, so every endpoint is undocumented.',
        documented: 'Documented',
        undocumented: 'Undocumented',
        callers: 'Called from: {names}',
        noCallers: 'No station imports this file.',
        downloadFailed: 'The file could not be downloaded.',
        tryIt: 'Try it',
        requestLine: 'Request',
        copyCurl: 'Copy as curl',
        exportOpenapi: 'Export OpenAPI skeleton',
        exportPostman: 'Export Postman collection',
        contractTests: 'Contract tests',
        contractTestsText: 'Write contract tests for these endpoints from the OpenAPI skeleton, run them and report each result: {routes}.',
        groupInContract: 'In contract ({count})',
        groupUndocumented: 'Undocumented ({count})',
        selectEndpoint: 'Include {route} in the contract tests',
        selectedCount: '{selected} of {endpoints} selected for contract tests',
        selectAtLeastOne: 'Select at least one endpoint to generate contract tests.',
        detailParams: 'Parameters',
        paramPath: 'path',
        paramQuery: 'query',
        paramBody: 'body',
        paramBodyNote: 'JSON body; its shape was not extracted from the code.',
        noParams: 'This route takes no parameters.',
        detailTested: 'Responses tested',
        testedYes: 'Tested ✓',
        testedNo: 'Not tested ✗',
        testedBy: 'A test file references the handler: {names}',
        testedNone: 'No test file references the handler.',
        detailCallers: 'Who calls it',
        callerFilesNone: 'No file references the handler.',
        sandboxTitle: 'Try it · sandbox',
        baseUrl: 'Base URL',
        baseUrlInvalid: 'Enter an http or https address, for example http://localhost:3000.',
        baseUrlRemote: 'This is not a local address. The request goes to it as typed.',
        paramValue: 'Value of {name}',
        paramMissing: 'Enter a value for {name}.',
        bodyInvalid: 'The body is not valid JSON.',
        bodyLabel: 'Request body (JSON)',
        send: 'Send',
        sending: 'Sending…',
        sendUnavailable: 'Send is available in the editor.',
        sendFailed: 'The request failed: {message}',
        resultStatus: '{status} · {ms} ms',
        resultHeaders: 'Response headers',
        resultBody: 'Response body',
        resultTruncated: 'The body is shortened to {count} characters.',
        resultEmpty: 'The response has no body.',
    },
};
