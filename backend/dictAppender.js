const fs = require('fs');

// File paths
const dndFile = 'dnd-words.json';
const commonFile = 'common.json'; // Adjust if the file name differs
const outputFile = 'dnd-words-updated.json'; // New file to avoid overwriting

function mergeWords() {
  try {
    // Load both JSON files
    const dndData = JSON.parse(fs.readFileSync(dndFile, 'utf8'));
    const commonData = JSON.parse(fs.readFileSync(commonFile, 'utf8'));

    // Extract word arrays (flexible key names)
    const dndWords = dndData.commonWords || dndData.words || [];
    const commonWords = commonData.commonWords || commonData.words || [];

    if (!Array.isArray(dndWords) || !Array.isArray(commonWords)) {
      throw new Error('One or both files do not contain a valid word array.');
    }

    // Use a Set for efficient duplicate checking
    const dndWordSet = new Set(dndWords);

    // Filter out words from common.json that are already in dnd-words.json
    const newWords = commonWords.filter(word => !dndWordSet.has(word));

    // Merge and sort the lists
    const updatedWords = [...dndWords, ...newWords].sort();

    // Update the dndData object
    dndData.commonWords = updatedWords;

    // Save the updated JSON
    fs.writeFileSync(outputFile, JSON.stringify(dndData, null, 2));
    console.log(`Merged ${newWords.length} new words. Total: ${updatedWords.length}. Saved to ${outputFile}`);

  } catch (error) {
    console.error('Error merging word lists:', error);
  }
}

// Run the script
mergeWords();