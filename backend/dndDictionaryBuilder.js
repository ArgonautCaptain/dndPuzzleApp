const fs = require('fs');
const path = require('path');

// Directory containing your markdown files
const markdownDir = './books'; // Adjust this path
const outputFile = 'dnd-words.json';

// Initialize the JSON structure
const wordListJson = {
  description: "Words extracted from D&D sourcebook markdown files for a fantasy cipher.",
  commonWords: []
};

function extractWordsFromMarkdown() {
  const uniqueWords = new Set();

  try {
    // Read all markdown files in the directory
    const files = fs.readdirSync(markdownDir).filter(file => file.endsWith('.md'));

    if (files.length === 0) {
      console.log('No markdown files found in the directory.');
      return;
    }

    files.forEach(file => {
      const filePath = path.join(markdownDir, file);
      let content = fs.readFileSync(filePath, 'utf8');

      // Remove markdown image embeds (e.g., ![](img/book/XGE/intro01.webp))
      content = content.replace(/!\[.*?\]\(.*?\)/g, '');

      // Remove inline links (e.g., [text](url)), keeping only the text
      content = content.replace(/\[([^\]]+)\]\(.*?\)/g, '$1');

      // Split into words, normalize, and filter
      const words = content
        .toLowerCase() // Case-insensitive
        .split(/\W+/) // Split on non-word characters (punctuation, spaces, etc.)
        .filter(word =>
          word.length > 0 &&          // No empty strings
          /^[a-z]+$/.test(word) &&    // Only letters (no numbers or symbols)
          !word.match(/^(http|www)/)  // Exclude URL fragments
        );

      // Add unique words to the Set
      words.forEach(word => uniqueWords.add(word));
    });

    // Convert Set to array and sort (optional)
    wordListJson.commonWords = [...uniqueWords].sort();

    // Save to JSON file
    fs.writeFileSync(outputFile, JSON.stringify(wordListJson, null, 2));
    console.log(`Extracted ${wordListJson.commonWords.length} unique words. Saved to ${outputFile}`);

  } catch (error) {
    console.error('Error processing markdown files:', error);
  }
}

// Run the script
extractWordsFromMarkdown();