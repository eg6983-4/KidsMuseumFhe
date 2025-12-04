// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract KidsMuseumFHE is SepoliaConfig {
    struct EncryptedChildProfile {
        uint256 profileId;
        euint32 encryptedAge;            // Encrypted child's age
        euint32 encryptedInterest1;      // Encrypted primary interest code
        euint32 encryptedInterest2;      // Encrypted secondary interest code
        uint256 timestamp;
    }
    
    struct PersonalizedTour {
        string[] recommendedExhibits;
        string[] interactiveGames;
        string learningPath;
        bool isRevealed;
    }

    uint256 public profileCount;
    mapping(uint256 => EncryptedChildProfile) public encryptedProfiles;
    mapping(uint256 => PersonalizedTour) public personalizedTours;
    
    mapping(string => euint32) private encryptedExhibitCount;
    string[] private exhibitList;
    
    mapping(uint256 => uint256) private requestToProfileId;
    
    event ProfileSubmitted(uint256 indexed profileId, uint256 timestamp);
    event TourRequested(uint256 indexed profileId);
    event TourGenerated(uint256 indexed profileId);
    
    modifier onlyParent(uint256 profileId) {
        // Add parent access control logic here
        _;
    }
    
    function submitEncryptedProfile(
        euint32 encryptedAge,
        euint32 encryptedInterest1,
        euint32 encryptedInterest2
    ) public {
        profileCount += 1;
        uint256 newId = profileCount;
        
        encryptedProfiles[newId] = EncryptedChildProfile({
            profileId: newId,
            encryptedAge: encryptedAge,
            encryptedInterest1: encryptedInterest1,
            encryptedInterest2: encryptedInterest2,
            timestamp: block.timestamp
        });
        
        personalizedTours[newId] = PersonalizedTour({
            recommendedExhibits: new string[](0),
            interactiveGames: new string[](0),
            learningPath: "",
            isRevealed: false
        });
        
        emit ProfileSubmitted(newId, block.timestamp);
    }
    
    function requestPersonalizedTour(uint256 profileId) public onlyParent(profileId) {
        EncryptedChildProfile storage profile = encryptedProfiles[profileId];
        require(!personalizedTours[profileId].isRevealed, "Tour already generated");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(profile.encryptedAge);
        ciphertexts[1] = FHE.toBytes32(profile.encryptedInterest1);
        ciphertexts[2] = FHE.toBytes32(profile.encryptedInterest2);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.generateTour.selector);
        requestToProfileId[reqId] = profileId;
        
        emit TourRequested(profileId);
    }
    
    function generateTour(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 profileId = requestToProfileId[requestId];
        require(profileId != 0, "Invalid request");
        
        PersonalizedTour storage tour = personalizedTours[profileId];
        require(!tour.isRevealed, "Tour already generated");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint32 age = results[0];
        uint32 interest1 = results[1];
        uint32 interest2 = results[2];
        
        tour.recommendedExhibits = getRecommendedExhibits(age, interest1, interest2);
        tour.interactiveGames = getInteractiveGames(age, interest1);
        tour.learningPath = generateLearningPath(age, interest1, interest2);
        tour.isRevealed = true;
        
        // Update exhibit popularity counts
        for (uint i = 0; i < tour.recommendedExhibits.length; i++) {
            string memory exhibit = tour.recommendedExhibits[i];
            if (FHE.isInitialized(encryptedExhibitCount[exhibit]) == false) {
                encryptedExhibitCount[exhibit] = FHE.asEuint32(0);
                exhibitList.push(exhibit);
            }
            encryptedExhibitCount[exhibit] = FHE.add(
                encryptedExhibitCount[exhibit], 
                FHE.asEuint32(1)
            );
        }
        
        emit TourGenerated(profileId);
    }
    
    function getPersonalizedTour(uint256 profileId) public view returns (
        string[] memory recommendedExhibits,
        string[] memory interactiveGames,
        string memory learningPath,
        bool isRevealed
    ) {
        PersonalizedTour storage pt = personalizedTours[profileId];
        return (pt.recommendedExhibits, pt.interactiveGames, pt.learningPath, pt.isRevealed);
    }
    
    function getEncryptedExhibitCount(string memory exhibit) public view returns (euint32) {
        return encryptedExhibitCount[exhibit];
    }
    
    function requestExhibitCountDecryption(string memory exhibit) public {
        euint32 count = encryptedExhibitCount[exhibit];
        require(FHE.isInitialized(count), "Exhibit not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptExhibitCount.selector);
        requestToProfileId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(exhibit)));
    }
    
    function decryptExhibitCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 exhibitHash = requestToProfileId[requestId];
        string memory exhibit = getExhibitFromHash(exhibitHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    // Helper functions for tour generation
    function getRecommendedExhibits(uint32 age, uint32 interest1, uint32 interest2) private pure returns (string[] memory) {
        string[] memory exhibits = new string[](3);
        
        if (age < 6) {
            exhibits[0] = "ChildrensDiscoveryZone";
            exhibits[1] = "InteractiveSciencePlay";
            exhibits[2] = "StorytellingCorner";
        } else if (age < 12) {
            exhibits[0] = getInterestBasedExhibit(interest1);
            exhibits[1] = getInterestBasedExhibit(interest2);
            exhibits[2] = "HandsOnScienceLab";
        } else {
            exhibits[0] = "TechnologyGallery";
            exhibits[1] = "InnovationStation";
            exhibits[2] = "FutureWorld";
        }
        
        return exhibits;
    }
    
    function getInterestBasedExhibit(uint32 interest) private pure returns (string memory) {
        if (interest == 1) return "DinosaurGallery";
        if (interest == 2) return "SpaceExploration";
        if (interest == 3) return "OceanWorld";
        if (interest == 4) return "ArtStudio";
        return "MainHall";
    }
    
    function getInteractiveGames(uint32 age, uint32 interest) private pure returns (string[] memory) {
        string[] memory games = new string[](2);
        
        if (age < 6) {
            games[0] = "ColorMatchingGame";
            games[1] = "ShapePuzzle";
        } else {
            if (interest == 1) {
                games[0] = "FossilDig";
                games[1] = "DinoDNA";
            } else if (interest == 2) {
                games[0] = "RocketBuilder";
                games[1] = "PlanetQuiz";
            } else {
                games[0] = "MuseumScavengerHunt";
                games[1] = "TimeTravelAdventure";
            }
        }
        
        return games;
    }
    
    function generateLearningPath(uint32 age, uint32 interest1, uint32 interest2) private pure returns (string memory) {
        if (age < 6) return "PlayBasedLearning";
        if (interest1 == 4 || interest2 == 4) return "ArtFocusedExperience";
        return "STEMDiscoveryPath";
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getExhibitFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < exhibitList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(exhibitList[i]))) == hash) {
                return exhibitList[i];
            }
        }
        revert("Exhibit not found");
    }
}