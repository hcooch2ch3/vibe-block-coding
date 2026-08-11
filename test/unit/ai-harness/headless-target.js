// Shared test helper: a headless real scratch-vm target.
//
// Not a *.test.js file, so jest does not collect it. Tests import makeHeadlessVM()
// to drive the real vm.shareBlocksToTarget / Blocks code paths (no mocks), matching
// how the editor actually injects blocks at runtime.
import VM from 'scratch-vm';
import Sprite from 'scratch-vm/src/sprites/sprite';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';

export function makeHeadlessVM () {
    const vm = new VM();

    // A stage target must exist: refreshWorkspace()/emitWorkspaceUpdate() reads
    // runtime.getTargetForStage().variables.
    const stageSprite = new Sprite(null, vm.runtime);
    stageSprite.name = 'Stage';
    const stage = new RenderedTarget(stageSprite, vm.runtime);
    stage.isStage = true;
    stage.id = 'stage';
    vm.runtime.addTarget(stage);

    const sprite = new Sprite(null, vm.runtime);
    sprite.name = 'Cat';
    const target = new RenderedTarget(sprite, vm.runtime);
    target.id = 'cat1';
    vm.runtime.addTarget(target);
    vm.editingTarget = target;
    return {vm, target};
}

// Ids of every block reachable from a script's hat (hat + stack + input shadows),
// so a test can assert those exact ids survive an edit (= existing scripts preserved).
export function reachableIds (blocks, hatId) {
    const ids = [];
    const walk = id => {
        if (!id) return;
        const b = blocks.getBlock(id);
        if (!b) return;
        ids.push(id);
        for (const key in b.inputs) {
            const inp = b.inputs[key];
            if (inp.block) walk(inp.block);
            if (inp.shadow && inp.shadow !== inp.block) walk(inp.shadow);
        }
        walk(b.next);
    };
    walk(hatId);
    return ids.sort();
}
