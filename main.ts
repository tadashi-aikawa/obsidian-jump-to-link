import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Editor } from 'codemirror';
import { LinkHintBase, LinkHintMode, LinkHintType, PreviewLinkHint, Settings, SourceLinkHint } from 'types';

export default class JumpToLink extends Plugin {
	isLinkHintActive: boolean = false;
	settings: Settings;
	prefixInfo: { prefix: string, shiftKey: boolean } | undefined = undefined;

	async onload() {
		console.log('loading jump to links plugin');

		this.settings = await this.loadData() || new Settings();

		this.addSettingTab(new SettingTab(this.app, this));

		this.addCommand({
			id: 'activate-jump-to-link',
			name: 'Jump to Link',
			callback: this.handleJumpToLink,
			hotkeys: [{modifiers: ['Ctrl'], key: '\''}]
		})
	}

	onunload() {
		console.log('unloading jump to links plugin');
		console.log('Jump to links plugin is off');
	}

	handleJumpToLink = () => {
		if (this.isLinkHintActive) {
			return;
		}

		const currentView = this.app.workspace.activeLeaf.view;

		if (currentView.getState().mode === 'preview') {
			const previewViewEl: HTMLElement = (currentView as any).previewMode.containerEl.querySelector('div.markdown-preview-view');
			this.managePreviewLinkHints(previewViewEl);
		} else if (currentView.getState().mode === 'source') {
			const cmEditor: Editor = (currentView as any).sourceMode.cmEditor;
			this.manageSourceLinkHints(cmEditor);
		}
	};

	managePreviewLinkHints = (previewViewEl: HTMLElement): void => {
		const linkHints = this.getPreviewLinkHints(previewViewEl);
		if (linkHints.length) {
			if (this.settings.mode === 'modal') {
				this.displayModal(linkHints);
			} else if (this.settings.mode === 'popovers') {
				this.displayPreviewPopovers(previewViewEl, linkHints);
			}
			this.activateLinkHints(linkHints);
		}
	}

	manageSourceLinkHints = (cmEditor: Editor): void => {
		const linkHints = this.getSourceLinkHints(cmEditor);
		if (linkHints.length) {
			if (this.settings.mode === 'modal') {
				this.displayModal(linkHints);
			} else if (this.settings.mode === 'popovers') {
				this.displaySourcePopovers(cmEditor, linkHints);
			}
			this.activateLinkHints(linkHints);
		}
	};

	activateLinkHints = (linkHints: LinkHintBase[]): void => {
		const linkHintMap: { [letter: string]: LinkHintBase } = {};
		linkHints.forEach(x => linkHintMap[x.letter] = x);

		const handleHotkey = (newLeaf: boolean, link: LinkHintBase) => {
			if (link.type === 'internal') {
				// not sure why the second argument in openLinkText is necessary.
				this.app.workspace.openLinkText(link.linkText, '', newLeaf, { active: true });
			} else if (link.type === 'external') {
				// todo
				require('electron').shell.openExternal(link.linkText);
			}
		}

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Shift') {
				return;
			}

			const eventKey = event.key.toUpperCase();
			const prefixes = new Set(Object.keys(linkHintMap).filter(x => x.length > 1).map(x => x[0]));

			let linkHint: LinkHintBase;
			if (this.prefixInfo) {
				linkHint = linkHintMap[this.prefixInfo.prefix + eventKey];
			} else {
				linkHint = linkHintMap[eventKey];
				if (!linkHint && prefixes && prefixes.has(eventKey)) {
					this.prefixInfo = { prefix: eventKey, shiftKey: event.shiftKey };

					event.preventDefault();
					event.stopPropagation();
					event.stopImmediatePropagation();
					
					return;
				}
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			const newLeaf = this.prefixInfo?.shiftKey || event.shiftKey;

			linkHint && handleHotkey(newLeaf, linkHint);

			document.removeEventListener('keydown', handleKeyDown);
			document.querySelectorAll('.jl.popover').forEach(e => e.remove());
			document.querySelectorAll('#jl-modal').forEach(e => e.remove());
			this.prefixInfo = undefined;
			this.isLinkHintActive = false;
		};

		document.addEventListener('keydown', handleKeyDown);
		this.isLinkHintActive = true;
	}

	getPreviewLinkHints = (previewViewEl: HTMLElement): PreviewLinkHint[] => {
		const anchorEls = previewViewEl.querySelectorAll('a');
		const embedEls = previewViewEl.querySelectorAll('.internal-embed');

		const linkHints: PreviewLinkHint[] = [];
		anchorEls.forEach((anchorEl, i) => {
			const linkType: LinkHintType = anchorEl.hasClass('internal-link') 
				? 'internal'
				: 'external';

			const linkText = linkType === 'internal'
				? anchorEl.dataset['href']
				: anchorEl.href;

			let offsetParent = anchorEl.offsetParent as HTMLElement;
			let top = anchorEl.offsetTop;
			let left = anchorEl.offsetLeft;

			while (offsetParent) {
				if (offsetParent == previewViewEl) {
					offsetParent = undefined;
				} else {
					top += offsetParent.offsetTop;
					left += offsetParent.offsetLeft;
					offsetParent = offsetParent.offsetParent as HTMLElement;
				}
			}

			linkHints.push({
				letter: '',
				linkText: linkText,
				type: linkType,
				top: top,
				left: left,
			});
		});

		embedEls.forEach((embedEl, i) => {
			const linkText = embedEl.getAttribute('src');
			const linkEl = embedEl.querySelector('.markdown-embed-link') as HTMLElement;

			if (linkText && linkEl) {
				let offsetParent = linkEl.offsetParent as HTMLElement;
				let top = linkEl.offsetTop;
				let left = linkEl.offsetLeft;

				while (offsetParent) {
					if (offsetParent == previewViewEl) {
						offsetParent = undefined;
					} else {
						top += offsetParent.offsetTop;
						left += offsetParent.offsetLeft;
						offsetParent = offsetParent.offsetParent as HTMLElement;
					}
				}

				linkHints.push({
					letter: '',
					linkText: linkText,
					type: 'internal',
					top: top,
					left: left,
				});
			}
		});

		const sortedLinkHints = linkHints.sort((a, b) => {
			if (a.top > b.top) {
				return 1;
			} else if (a.top === b.top) {
				if (a.left > b.left) {
					return 1;
				} else if (a.left === b.left) {
					return 0; 
				} else {
					return -1;
				}
			} else {
				return -1;
			}
		});

		const linkHintLetters = this.getLinkHintLetters(sortedLinkHints.length);

		sortedLinkHints.forEach((linkHint, i) => {
			linkHint.letter = linkHintLetters[i];
		});

		return sortedLinkHints;
	}
	
	getSourceLinkHints = (cmEditor: Editor): SourceLinkHint[] => {
		// expecting either [[Link]] or [[Link|Title]]
		const regExInternal = /\[\[(.+?)(\|.+?)?\]\]/g;
		// expecting [Title](link)
		const regExExternal = /\[.+?\]\((.+?)\)/g;
		// expecting http://hogehoge or https://hogehoge
		const regExUrl = /(?<= |\n|^)(https?:\/\/[^ \n]+)/g;

		const strs = cmEditor.getValue();

		let linksWithIndex: { index: number, type: 'internal' | 'external', linkText: string }[] = [];
		let regExResult;

		while(regExResult = regExInternal.exec(strs)) {
			const linkText = regExResult[1];
			linksWithIndex.push({ index: regExResult.index, type: 'internal', linkText });
		}

		while(regExResult = regExExternal.exec(strs)) {
			const linkText = regExResult[1];
			linksWithIndex.push({ index: regExResult.index, type: 'external', linkText })
		}

		while(regExResult = regExUrl.exec(strs)) {
			const linkText = regExResult[1];
			linksWithIndex.push({ index: regExResult.index, type: 'external', linkText })
		}

		const linkHintLetters = this.getLinkHintLetters(linksWithIndex.length);

		const linksWithLetter: SourceLinkHint[] = [];
		linksWithIndex
			.sort((x,y) => x.index - y.index)
			.forEach((linkHint, i) => {
				linksWithLetter.push({ letter: linkHintLetters[i], ...linkHint});
			});

		return linksWithLetter;
	}

	getLinkHintLetters = (numLinkHints: number): string[] => {
		const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

		let prefixCount = Math.ceil((numLinkHints - alphabet.length) / (alphabet.length - 1))

		// ensure 0 <= prefixCount <= alphabet.length
		prefixCount = Math.max(prefixCount, 0);
		prefixCount = Math.min(prefixCount, alphabet.length);

		const prefixes = ['', ...Array.from(alphabet.slice(0, prefixCount))];

		const linkHintLetters = []
		for (var i = 0; i < prefixes.length; i++) {
			const prefix = prefixes[i]
			for (var j = 0; j < alphabet.length; j++) {
				if (linkHintLetters.length < numLinkHints) {
					const letter = alphabet[j];
					if (prefix === '') {
						if (!prefixes.includes(letter)) {
							linkHintLetters.push(letter);
						}
					} else {
						linkHintLetters.push(prefix + letter)
					}
				} else {
					break;
				}
			}
		}

		return linkHintLetters;
	}

	displayModal = (linkHints: LinkHintBase[]): void => {
		const modalEl = document.createElement('div');
		modalEl.innerHTML =  `
			<div class="modal-container" id="jl-modal">
				<div class="modal-bg"></div>
				<div class="modal">
					<div class="modal-close-button"></div>
					<div class="modal-title">Jump to links</div>
					<div class="modal-content"></div>
				</div>
			</div>
		`;
		modalEl.querySelector('.modal-close-button').addEventListener('click', modalEl.remove);
		document.body.appendChild(modalEl);

		const linkEl = (content: string) => {
			const el = document.createElement('div');
			el.innerHTML = content;
			return el;
		};

		const modalContentEl = modalEl.querySelector('.modal-content');
		linkHints.forEach((linkHint: LinkHintBase) =>
			modalContentEl.appendChild(linkEl(linkHint.letter + ' ' + linkHint.linkText))
		);
	}

	displayPreviewPopovers = (markdownPreviewViewEl: HTMLElement, linkHints: PreviewLinkHint[]): void => {
		for (var linkHint of linkHints) {
			const linkHintEl = markdownPreviewViewEl.createEl('div');
			linkHintEl.style.top = linkHint.top + 'px';
			linkHintEl.style.left = linkHint.left + 'px';

			linkHintEl.textContent = linkHint.letter;
			linkHintEl.addClass('jl');
			linkHintEl.addClass('popover');
		}
	}

	displaySourcePopovers = (cmEditor: Editor, linkKeyMap: SourceLinkHint[]): void => {
		const createWidgetElement = (content: string) => {
			const linkHintEl = document.createElement('div');
			linkHintEl.addClass('jl');
			linkHintEl.addClass('popover');
			linkHintEl.innerHTML = content;
			return linkHintEl;
		}

		const drawWidget = (cmEditor: Editor, linkHint: SourceLinkHint) => {
			const pos = cmEditor.posFromIndex(linkHint.index);
			// the fourth parameter is undocumented. it specifies where the widget should be place
			return (cmEditor as any).addWidget(pos, createWidgetElement(linkHint.letter), false, 'over');
		}

		linkKeyMap.forEach(x => drawWidget(cmEditor, x));
	}
}

class SettingTab extends PluginSettingTab {
	plugin: JumpToLink

    constructor(app: App, plugin: JumpToLink) {
        super(app, plugin)

		this.plugin = plugin
	}

	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for Jump To Link.'});

		new Setting(containerEl)
			.setName('Presentation')
			.setDesc('How to show links')
			.addDropdown(cb => { cb
				.addOptions({
					"popovers": 'Popovers',
					"modal": 'Modal'
				})
				.setValue(this.plugin.settings.mode)
				.onChange((value: LinkHintMode) => {
					this.plugin.settings.mode = value;
					this.plugin.saveData(this.plugin.settings);
				})
			});
	}
}
