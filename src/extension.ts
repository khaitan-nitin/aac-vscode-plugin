// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as yaml from 'yaml'; // You'll need to install the 'yaml' package
import * as path from 'path';

interface MetadataSchema {
	spec: {
		properties: {
			[key: string]: {
				type: string;
				description: string;
				enum?: string[];
				properties?: any; // For nested objects
				items?: any; // For arrays
			};
		};
	};
}

interface UsedProperties {
	Company: boolean;
	Domain: boolean;
	Nodes: boolean;
	Relationships: boolean;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let metadata: MetadataSchema | null = null;
	let usedProperties: UsedProperties = {
		Company: false,
		Domain: false,
		Nodes: false,
		Relationships: false
	};
	let nodeNames: string[] = [];  // Add this to track node names

	// Function to load metadata
	function loadMetadata() {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) return null;
			
			const metadataPath = path.join(workspaceFolders[0].uri.fsPath, '../smart-hint/metadata.yaml');
			const metadataContent = fs.readFileSync(metadataPath, 'utf8');
			return yaml.parse(metadataContent);
		} catch (error) {
			console.error('Failed to load metadata:', error);
			return null;
		}
	}

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "smart-hint" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('smart-hint.architectureAsCode', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Architecture as code smart-hint support!');
	});

	// Add this function to extract node names
	function updateNodeNames(document: vscode.TextDocument) {
		nodeNames = [];
		let inNodesSection = false;
		
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;
			if (line.match(/^\s*Nodes\s*:/)) {
				inNodesSection = true;
				continue;
			}
			
			if (inNodesSection) {
				const match = line.match(/^\s*-\s*([^:\s]+)\s*:/);
				if (match) {
					nodeNames.push(match[1]);
				}
				// Exit if we hit another top-level property
				if (line.match(/^[A-Za-z]/)) {
					inNodesSection = false;
				}
			}
		}
		console.log('Updated node names:', nodeNames);
	}

	// Update the updateUsedProperties function to also update node names
	function updateUsedProperties(document: vscode.TextDocument) {
		usedProperties = {
			Company: false,
			Domain: false,
			Nodes: false,
			Relationships: false
		};

		// Use a more robust regex pattern that accounts for whitespace
		const patterns = {
			Company: /^\s*Company\s*:/,
			Domain: /^\s*Domain\s*:/,
			Nodes: /^\s*Nodes\s*:/,
			Relationships: /^\s*Relationships\s*:/
		};

		// Check the entire document content
		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text.trim();
			
			// Check each pattern
			for (const [key, pattern] of Object.entries(patterns)) {
				if (pattern.test(line)) {
					usedProperties[key as keyof UsedProperties] = true;
				}
			}
		}

		updateNodeNames(document);
	}

	function getUsedPropertiesAtCurrentLevel(
		document: vscode.TextDocument,
		position: vscode.Position,
		currentIndent: number
	): Set<string> {
		const usedProps = new Set<string>();
		let startLine = position.line;
		let endLine = position.line;

		// Search backwards
		while (startLine > 0) {
			const line = document.lineAt(startLine - 1).text;
			const indent = getIndentLevel(line);
			if (indent < currentIndent) break;
			startLine--;
		}

		// Search forwards
		while (endLine < document.lineCount - 1) {
			const line = document.lineAt(endLine + 1).text;
			const indent = getIndentLevel(line);
			if (indent < currentIndent) break;
			endLine++;
		}

		// Collect used properties at this level
		for (let i = startLine; i <= endLine; i++) {
			if (i === position.line) continue; // Skip current line
			const line = document.lineAt(i).text;
			const indent = getIndentLevel(line);
			if (indent === currentIndent) {
				const match = line.match(/^\s*([^:\s]+):/);
				if (match) {
					usedProps.add(match[1]);
				}
			}
		}

		return usedProps;
	}

	function canHaveChildren(property: any): boolean {
		const haveChildren: boolean = property?.type === 'object' || property?.items?.properties;

		return haveChildren;
	}

	// Create the base provider object
	const baseProvider = {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
			if (!metadata) {
				metadata = loadMetadata();
			}

			if (!metadata) {
				return [];
			}

			// Update used properties first
			updateUsedProperties(document);

			const lineText = document.lineAt(position).text;
			const linePrefix = lineText.substr(0, position.character);
			let currentIndent = getIndentLevel(lineText);
			console.log("currentIndent-1: ", currentIndent);
			const parentProperty = findParentProperty(document, position, currentIndent);
			console.log("parentProperty: ", parentProperty);
			
			// Get properties already used at current level
			const usedPropsAtLevel = getUsedPropertiesAtCurrentLevel(document, position, currentIndent);

			// Get the partial text the user has typed
			const partialInput = linePrefix.trim();

			// Check if we're on a new line after a property
			const previousLine = position.line > 0 ? document.lineAt(position.line - 1).text : '';
			const previousProperty = previousLine.match(/^\s*([^:\s]+):/)?.[1];
			
			if (previousProperty) {
				const prevPropMeta = findPropertyInMetadata(metadata, previousProperty);
				console.log("1");
				if (!canHaveChildren(prevPropMeta)) {
					console.log("2");
					// Reset indentation to parent level if previous property can't have children
					currentIndent = getIndentLevel(previousLine);
					console.log("currentIndent-2: ", currentIndent);
				}
			}

			const suggestions: vscode.CompletionItem[] = [];

			if (linePrefix.trimEnd().endsWith(':')) {
				const propertyName = linePrefix.trimEnd().slice(0, -1).trim();
				const parentProp = findParentProperty(document, position, currentIndent);
				let property;

				if (parentProp) {
					property = findPropertyInMetadata(metadata, `${parentProp}.${propertyName}`);
				} else {
					property = findPropertyInMetadata(metadata, propertyName);
				}
				
				// Modify this section to handle start/end properties
				if (property?.enum || (parentProp === 'Relationships' && (propertyName === 'Start' || propertyName === 'End'))) {
					const values = propertyName === 'Start' || propertyName === 'End' ? nodeNames : property.enum;
					values.forEach((enumValue: any) => {
						const item = new vscode.CompletionItem(enumValue, vscode.CompletionItemKind.EnumMember);
						item.insertText = ` ${enumValue}`;
						suggestions.push(item);
					});
				}
			} else {
				// Handle root level suggestions
				if (!parentProperty) {
					// Only suggest properties that haven't been used and match partial input
					const rootProperties = [
						{ name: 'Company', used: usedProperties.Company },
						{ name: 'Domain', used: usedProperties.Domain },
						{ name: 'Nodes', used: usedProperties.Nodes },
						{ name: 'Relationships', used: usedProperties.Relationships }
					];

					rootProperties.forEach(prop => {
						if (!prop.used && !usedPropsAtLevel.has(prop.name) && 
							(!partialInput || prop.name.toLowerCase().startsWith(partialInput.toLowerCase()))) {
							const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Field);
							item.detail = metadata!.spec.properties[prop.name].type;
							item.documentation = metadata!.spec.properties[prop.name].description;
							item.insertText = `${prop.name}:`;
							suggestions.push(item);
						}
					});
				} else if (parentProperty === 'Domain') {
					// Handle Domain properties - suggest only unused properties that match partial input
					const domainProps = metadata.spec.properties.Domain.properties;
					for (const [key, value] of Object.entries(domainProps)) {
						if (!usedPropsAtLevel.has(key) && 
							(!partialInput || key.toLowerCase().startsWith(partialInput.toLowerCase()))) {
							suggestions.push(createCompletionItem(key, value, 2));
						}
					}
				} else if (parentProperty === 'Nodes' || parentProperty === 'Relationships') {
					const itemProperties = metadata.spec.properties[parentProperty].items.properties;
					processForNodeWithArray(lineText, previousProperty, parentProperty, suggestions, itemProperties, usedPropsAtLevel, partialInput);
				}
			}

			return suggestions;
		}
	};

	const yamlCompletionProvider = vscode.languages.registerCompletionItemProvider(
		{ scheme: 'file', language: 'yaml' },
		baseProvider,
		':', ' ', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
		'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
		'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
		'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
	);

	// Update the newline provider to use baseProvider
	const newlineProvider = vscode.languages.registerCompletionItemProvider(
		{ scheme: 'file', language: 'yaml' },
		{
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				if (!metadata) {
					metadata = loadMetadata();
				}

				if (!metadata) {
					return [];
				}

				const lineText = document.lineAt(position.line - 1).text;
				const currentProperty = lineText.match(/^\s*([^:\s]+):/)?.[1];
				const currentIndent = getIndentLevel(lineText);
				
				if (currentProperty) {
					const property = findPropertyInMetadata(metadata, currentProperty);
					if (!canHaveChildren(property)) {
						return baseProvider.provideCompletionItems(
							document,
							new vscode.Position(position.line, currentIndent)
						);
					}
				}
				return baseProvider.provideCompletionItems(document, position);
			}
		},
		'\n'
	);

	function processForNodeWithArray(
		lineText: string, 
		previousProperty: string | undefined, 
		parentProperty: string, 
		suggestions: vscode.CompletionItem[], 
		itemProperties: any, 
		usedPropsAtLevel: Set<string>,
		partialInput: string
	) {
		if (!lineText.trim().startsWith('-') && previousProperty === parentProperty) {
			const dashItem = new vscode.CompletionItem('- ', vscode.CompletionItemKind.Operator);
			dashItem.insertText = '- ';
			suggestions.push(dashItem);
		} else {
			const orderedKeys = Object.keys(itemProperties);
			for (const key of orderedKeys) {
				if (!usedPropsAtLevel.has(key) && 
					(!partialInput || key.toLowerCase().startsWith(partialInput.toLowerCase()))) {
					const value = itemProperties[key];
					const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Field);
					item.detail = value.type;
					item.documentation = value.description;

					const dashPos = lineText.indexOf('-');
					const baseIndent = ''.repeat(dashPos + 2);
					item.insertText = `${baseIndent}${key}:`;

					if (value.enum) {
						item.command = {
							command: 'editor.action.triggerSuggest',
							title: 'Suggest'
						};
					}

					suggestions.push(item);
				}
			}
		}
	}

	// Add these helper functions

	function getIndentLevel(line: string): number {
		const match = line.match(/^(\s*)/);
		return match ? match[1].length : 0;
	}

	function findParentProperty(
		document: vscode.TextDocument,
		position: vscode.Position,
		currentIndent: number
	): string | null {
		let lineNumber = position.line - 1;
		
		while (lineNumber >= 0) {
			const line = document.lineAt(lineNumber).text;
			const lineIndent = getIndentLevel(line);
			
			// If we find a line with zero indentation, we're at root level
			if (lineIndent === 0) {
				const match = line.match(/^([^:\s]+):/);
				if (match) {
					return match[1];
				}
				return null; // We're at root level but no property found
			}
			
			// If we find a line with less indentation than current
			if (lineIndent < currentIndent) {
				const match = line.match(/^\s*([^:\s]+):/);
				if (match) {
					return match[1];
				}
			}
			lineNumber--;
		}
		
		return null;
	}

	function findPropertyInMetadata(
		metadata: MetadataSchema,
		propertyPath: string | null
	): any {
		if (!propertyPath) {
			return metadata.spec;
		}

		const parts = propertyPath.split('.');
		let current: any = metadata.spec.properties;
		
		for (const part of parts) {
			if (!current[part]) return null;
			
			// If this is the last part, return the property itself
			if (parts[parts.length - 1] === part) {
				return current[part];
			}
			
			// Otherwise, navigate to nested properties
			if (current[part].properties) {
				current = current[part].properties;
			} else if (current[part].items?.properties) {
				current = current[part].items.properties;
			} else {
				return current[part];
			}
		}
		
		return current;
	}

	function createCompletionItem(key: string, value: any, indent: number = 0): vscode.CompletionItem {
		const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Field);
		item.detail = value.type;
		item.documentation = value.description;
		
		// Always use 2 spaces for child properties, regardless of nesting level
		const indentStr = indent === 0 ? '' : '';
		item.insertText = `${indentStr}${key}:`;
		return item;
	}

	// Register both providers
	context.subscriptions.push(
		yamlCompletionProvider,
		newlineProvider
	);

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
