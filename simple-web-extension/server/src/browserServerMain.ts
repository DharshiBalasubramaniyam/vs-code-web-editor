import {
    BrowserMessageReader,
    BrowserMessageWriter,
    createConnection,
    InitializeParams,
    InitializeResult,
    TextDocuments
} from 'vscode-languageserver/browser';
import { TextDocument } from 'vscode-languageserver-textdocument';

const ws = new WebSocket(`ws://localhost:9090/bal`);

ws.onopen = () => {
    console.log('Connected to WebSocket server');
};

const browserReader = new BrowserMessageReader(self);
const browserWriter = new BrowserMessageWriter(self);
const connection = createConnection(browserReader, browserWriter);

interface WorkspaceFolderPath {
	relativePath: string,
	absolutePath: string
}
let workspaceFolders: WorkspaceFolderPath[] = []

// file:///folder/main.bal
// file:///home/dharshi/Documents/ballerina/folder/main.bal

connection.onInitialize(async (_params: InitializeParams): Promise<InitializeResult> => {
    console.log(_params);
    const request = getRpcRequest(1, "initialize", resolveAbsolutePath(_params))
    return sendRequestToWS(request) as Promise<InitializeResult>;
});

connection.onInitialized(() => {
    console.log('Connection initialized');
    sendNotificationToWS("initialized", {});
});

// TODO: Check below 2 lines are actually needed
const documents = new TextDocuments(TextDocument);
documents.listen(connection);

connection.listen();

connection.onDidOpenTextDocument(async (params) => {
    sendNotificationToWS("textDocument/didOpen", resolveAbsolutePath(params));
})

connection.onDidCloseTextDocument((params) => {
    sendNotificationToWS("textDocument/didClose", resolveAbsolutePath(params));
})

connection.onDidChangeTextDocument((params) => {
    sendNotificationToWS("textDocument/didChange", resolveAbsolutePath(params));
})

connection.onRequest((method, params) => {
    // TODO: find a proper id generating way
    const requestId = Math.floor(Math.random() * 100000);
    const request = getRpcRequest(requestId, method, resolveAbsolutePath(params));
    return sendRequestToWS(request);
});

connection.onNotification((method, params) => {
    if (params && "textDocument" in params && "uri" in (params.textDocument as any)) {
        return sendNotificationToWS(method, resolveAbsolutePath(params));
    }
    sendNotificationToWS(method, params);
});

connection.onNotification('workspace/folders', (details: WorkspaceFolderPath[]) => {
    console.log('Received workspace folder details:', details);
    workspaceFolders = details;
});

ws.onmessage = async (event) => {
    const response = resolveRelativePath(event.data);
    if (response.method && response.id) {
        console.log('Received request from WebSocket server:', response);
        connection.sendRequest(response.method, response.params).then((result) => {
            console.log(`Forwarding response for request ${response.method} to WebSocket server: `, result);
            ws.send(JSON.stringify({
                jsonrpc: "2.0",
                id: response.id,
                result: resolveAbsolutePath(result)
            }));
        });
    } else if (!response.id) {
        console.log('Received notification from WebSocket server:', response);
        connection.sendNotification(response.method, response.params);
    }
}

function sendRequestToWS(request: any) {
    console.log(`Forwarding request to WebSocket server: ${request.method}`, request.params);
    return new Promise((resolve, reject) => {
        const handleMessage = (event: MessageEvent) => {
            try {
                const response = resolveRelativePath(event.data);
                if (response.id === request.id) {
                    console.log(`Received response for ${request.method}:`, response);
                    ws.removeEventListener('message', handleMessage);
                    resolve(response.result);
                }
            } catch (error) {
                console.error(`Error processing response for ${request.method}:`, error);
                reject(error);
            }
        };

        ws.addEventListener('message', handleMessage);

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(request));
        } else {
            ws.onopen = () => {
                console.log('Connected to WebSocket server');
                ws.send(JSON.stringify(request));
            };
        }
        // setTimeout(() => {
        //     reject(new Error(`Timeout waiting for response from WebSocket for ${method}`));
        // }, 5000);
    });
}

function sendNotificationToWS(method: string, params: object | any[] | undefined) {
    console.log(`Forwarding notification to WebSocket server: ${method}`, params);
    const request = getRpcNotification(method, params)
    ws.send(request);
    console.log('Sent notification:', request);
}

function getRpcNotification(method: string, params: object | any[] | undefined) {
    return JSON.stringify({
        jsonrpc: "2.0",
        method: method,
        params: params
    });
}

function getRpcRequest(id: number, method: string, params: object | any[] | undefined) {
    return {
        id: id,
        jsonrpc: "2.0",
        method: method,
        params: params
    };
}

function resolveAbsolutePath(params: object | any | undefined) {
    let paramsStr = JSON.stringify(params);
    workspaceFolders.forEach(folder => {
        paramsStr = paramsStr.replace(new RegExp(folder.relativePath, 'g'), folder.absolutePath);
    });
    return JSON.parse(paramsStr);
}

function resolveRelativePath(data: any) {
    let responseStr = data as string;
    workspaceFolders.forEach(folder => {
        responseStr = responseStr.replace(new RegExp(folder.absolutePath, 'g'), folder.relativePath);
    });
    return JSON.parse(responseStr);
}



