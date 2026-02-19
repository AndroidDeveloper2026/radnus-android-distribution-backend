// const Territory = require('./models/TerritoryModel/Territory'); // adjust path

// const rawData = require('./utils/territoryData.json'); // your JSON file



// const transformAndInsert = async () => {
//   try {
//     const finalData = [];

//     rawData.forEach(countryObj => {
//       Object.keys(countryObj).forEach(state => {
//         const districts = countryObj[state];

//         Object.keys(districts).forEach(district => {
//           const taluks = districts[district];

//           taluks.forEach(taluk => {
//             finalData.push({
//               state,
//               district,
//               taluk,
//               beats: [],
//               assignedTo: null,
//               active: true
//             });
//           });
//         });
//       });
//     });

//     await Territory.insertMany(finalData);

//     console.log('✅ Data inserted successfully');
//     process.exit();
//   } catch (err) {
//     console.error(err);
//     process.exit(1);
//   }
// };

// transformAndInsert();